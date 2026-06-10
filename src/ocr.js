// ocr.js — 이미지에서 글자를 뽑아내는 OCR 담당 모듈
//
// OCR(Optical Character Recognition, 광학 문자 인식) =
//   "사진 속 글자를 컴퓨터가 읽을 수 있는 텍스트로 바꾸는 기술"
//
// 우리는 Tesseract.js라는 무료 라이브러리를 씁니다.
//  - 구글이 만든 OCR 엔진(Tesseract)을 브라우저에서 돌게 만든 것
//  - 서버도, API 키도, 결제도 필요 없음 → 전부 사용자 브라우저 안에서 처리
//  - index.html에서 <script>로 불러와서 전역(window.Tesseract)으로 존재합니다.
//
// ★ 인식률을 올리는 핵심은 "Tesseract에 넣기 전 이미지 손질(전처리)"입니다.
//   폰 캡쳐는 OCR에 불리한 점이 많아요:
//   1) 다크모드 = 어두운 배경에 흰 글씨 → Tesseract는 흰 배경에 검은 글씨를 훨씬 잘 읽음
//   2) 글씨가 작음 → 확대해서 넣으면 인식률이 크게 오름
//   3) 회색 글씨(시간·잔액 줄) → 대비를 늘려 또렷하게
//   그래서 [확대 → 흑백 → 어두우면 반전 → 대비 보정] 후에 넣습니다.

// 전처리 목표 크기: 짧은 변이 이 픽셀 이상이 되도록 확대 (이미 크면 그대로)
const TARGET_WIDTH = 1600;
// 너무 큰 이미지는 메모리/속도 문제가 생기니 상한을 둠
const MAX_WIDTH = 2600;

/**
 * 이미지에서 글자를 추출합니다.
 * @param {File|Blob|string} image - 고른 파일 또는 이미지 URL
 * @param {(percent:number)=>void} [onProgress] - 진행률(0~100) 콜백
 * @param {{preprocess?: boolean}} [opts] - preprocess:false면 원본 그대로 인식(재시도용)
 * @returns {Promise<string>} 추출된 원문 텍스트
 */
export async function extractText(image, onProgress, opts = {}) {
  const usePre = opts.preprocess !== false;

  // 전처리에 실패하면(아주 옛날 브라우저 등) 원본으로라도 진행
  let input = image;
  if (usePre) {
    try {
      input = await preprocessImage(image);
    } catch (e) {
      console.warn("이미지 전처리 실패 — 원본으로 인식 진행", e);
    }
  }

  const worker = await Tesseract.createWorker("kor+eng", 1, {
    // logger: OCR이 진행되는 동안 상태를 계속 알려줍니다.
    logger: (m) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });
  try {
    await worker.setParameters({
      // 4 = "한 줄씩 위에서 아래로 읽는 단일 컬럼" 모드.
      // 거래내역 화면(한 줄에 한 항목)과 구조가 같아, 기본(자동)보다
      // 줄 순서가 덜 뒤섞이고 좌우 텍스트가 한 줄로 잘 묶입니다.
      tessedit_pageseg_mode: "4",
      // 단어 사이 공백을 보존 (가맹점명 + 금액이 한 줄에 같이 있어서)
      preserve_interword_spaces: "1",
    });
    const result = await worker.recognize(input);
    // result.data.text 안에 인식된 전체 글자가 들어있습니다.
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}

/**
 * 캡쳐를 OCR이 읽기 좋게 손질한 캔버스를 돌려줍니다.
 * [확대 → 흑백 → 어두운 배경이면 반전 → 대비 보정]
 * @param {File|Blob|string} image
 * @returns {Promise<HTMLCanvasElement>}
 */
async function preprocessImage(image) {
  const bitmap = await loadBitmap(image);

  // 1) 확대: 작은 글씨일수록 확대 효과가 큼 (이미 충분히 크면 그대로)
  let scale = 1;
  if (bitmap.width < TARGET_WIDTH) scale = TARGET_WIDTH / bitmap.width;
  if (bitmap.width * scale > MAX_WIDTH) scale = MAX_WIDTH / bitmap.width;

  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();

  const imgData = ctx.getImageData(0, 0, w, h);
  const px = imgData.data;

  // 2) 흑백 변환 + 밝기 분포 수집
  const gray = new Uint8ClampedArray(px.length / 4);
  let sum = 0;
  for (let i = 0, g = 0; i < px.length; i += 4, g++) {
    // 사람 눈의 민감도를 반영한 표준 흑백 공식
    const v = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    gray[g] = v;
    sum += v;
  }
  const mean = sum / gray.length;

  // 3) 다크모드 감지: 평균 밝기가 어두우면 = 어두운 배경에 밝은 글씨 → 반전
  const invert = mean < 128;

  // 4) 대비 보정: 밝기 분포의 아래/위 1%를 잘라내고 0~255로 펴줌
  //    (회색 글씨·연한 배경 무늬가 또렷해짐)
  const hist = new Uint32Array(256);
  for (let g = 0; g < gray.length; g++) hist[gray[g] | 0]++;
  const clip = gray.length * 0.01;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > clip) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > clip) { hi = v; break; } }
  const range = Math.max(hi - lo, 1);

  for (let i = 0, g = 0; i < px.length; i += 4, g++) {
    let v = ((gray[g] - lo) / range) * 255;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    if (invert) v = 255 - v;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/** File/Blob/URL 무엇이 와도 그릴 수 있는 비트맵으로 만듭니다. */
async function loadBitmap(image) {
  if (typeof createImageBitmap === "function" && (image instanceof Blob)) {
    return createImageBitmap(image);
  }
  // URL 문자열이거나 createImageBitmap이 없는 환경: <img>로 로드
  const url = typeof image === "string" ? image : URL.createObjectURL(image);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });
    return img;
  } finally {
    if (typeof image !== "string") URL.revokeObjectURL(url);
  }
}
