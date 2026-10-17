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
// 캔버스 한 장의 픽셀 상한: iOS Safari는 약 1,670만 픽셀을 넘는 캔버스를 그리지 못해(빈 그림이 됨),
// 세로로 아주 긴 캡쳐(스크롤 캡쳐 등)는 통째로 키우지 않고 이 크기 이하의 조각으로 나눠 읽는다.
const MAX_PIXELS = 16000000;
// 조각을 자를 자리: 조각 아래쪽 이 비율 안에서, 글자가 없는 행이 BLANK_RUN줄 이상 이어지는 곳 (글자 줄이 반으로 잘리지 않게)
const CUT_ZONE = 0.25;
const BLANK_RUN = 4;
// 엔진·한글 데이터를 준비하는 동안 이만큼 아무 소식이 없으면 실패로 본다 (망이 끊긴 채 멈춰 영원히 기다리지 않게)
const READY_TIMEOUT_MS = 90000;
// 미리보기 그림 너비 (화면에 110~170px로 보이니, 고해상도 폰에서도 또렷한 정도)
const THUMB_WIDTH = 480;

/**
 * OCR 작업자(worker)를 하나 띄워, 여러 장을 차례로 읽을 수 있는 리더를 돌려줍니다.
 * 작업자를 띄울 때마다 한글 데이터를 다시 불러오므로, 여러 장은 한 작업자로 이어 읽는 게 훨씬 빠릅니다.
 * 다 읽었으면 terminate()로 꼭 정리하세요.
 * 엔진·언어 데이터를 못 불러오면(오프라인 등) 거부됩니다.
 * @returns {Promise<{
 *   read: (image: File|Blob|string, onProgress?: (percent:number)=>void, opts?: {preprocess?: boolean}) => Promise<string>,
 *   terminate: () => Promise<void>,
 * }>} read: 한 장의 원문 텍스트 (preprocess:false면 원본 그대로 인식 — 재시도용)
 */
export async function createReader() {
  // logger는 작업자를 띄울 때 한 번만 정해지므로, 지금 읽는 장의 진행률 콜백을 여기에 바꿔 끼웁니다.
  let onProgress = null;
  // 준비 중(작업자가 만들어지기 전)의 실패를 받을 곳. 준비가 끝나면 비움
  let failReady = null;
  let readyTimer = 0;
  const readyFailed = new Promise((_, reject) => (failReady = reject));
  const armReadyTimer = () => {
    clearTimeout(readyTimer);
    readyTimer = setTimeout(() => failReady && failReady(new Error("OCR 엔진 준비 시간 초과")), READY_TIMEOUT_MS);
  };

  const creating = Tesseract.createWorker("kor+eng", 1, {
    // logger: OCR이 진행되는 동안 상태를 계속 알려줍니다.
    logger: (m) => {
      if (failReady) armReadyTimer(); // 준비 중엔 소식이 올 때마다 시간 제한을 다시 잼 (느린 망에서도 진행 중이면 기다림)
      if (m.status === "recognizing text" && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
    // Tesseract.js는 언어 데이터 받기·초기화가 실패하면 createWorker를 끝내지 않고(영원히 대기) 이것만 불러준다.
    // 그래서 준비 중엔 실패로 바꿔 전하고, 준비 뒤의 실패(깨진 그림 등)는 read()의 거부로 이미 받으니 기록만.
    // (이게 없으면 실패한 작업의 오류를 전역에 한 번 더 던져 '처리 안 된 오류'가 남음)
    errorHandler: (err) => {
      if (failReady) failReady(err instanceof Error ? err : new Error(String(err)));
      else console.warn("OCR 작업 실패", err);
    },
  });
  armReadyTimer();
  let worker;
  try {
    worker = await Promise.race([creating, readyFailed]);
  } catch (e) {
    // 늦게라도 만들어지면 바로 정리 (실패한 채 멈춘 작업자는 Tesseract.js가 손잡이를 주지 않아 정리할 수 없음)
    creating.then((w) => w.terminate()).catch(() => {});
    throw e;
  } finally {
    clearTimeout(readyTimer);
    failReady = null;
  }
  try {
    await worker.setParameters({
      // 4 = "한 줄씩 위에서 아래로 읽는 단일 컬럼" 모드.
      // 거래내역 화면(한 줄에 한 항목)과 구조가 같아, 기본(자동)보다
      // 줄 순서가 덜 뒤섞이고 좌우 텍스트가 한 줄로 잘 묶입니다.
      tessedit_pageseg_mode: "4",
      // 단어 사이 공백을 보존 (가맹점명 + 금액이 한 줄에 같이 있어서)
      preserve_interword_spaces: "1",
    });
  } catch (e) {
    await worker.terminate();
    throw e;
  }

  // 한 그림(또는 조각)을 인식. pct는 그 그림 안에서의 진행률
  async function recognize(input, onPct) {
    onProgress = onPct || null;
    try {
      const result = await worker.recognize(input);
      // result.data.text 안에 인식된 전체 글자가 들어있습니다.
      return result.data.text;
    } finally {
      onProgress = null;
    }
  }

  return {
    async read(image, progress, opts = {}) {
      if (opts.preprocess === false) return recognize(image, progress);
      // 손질한 조각을 하나씩 만들어 읽고 바로 비움 (조각을 한꺼번에 만들어 두면 메모리를 몇 배로 씀)
      const pieces = preprocessImage(image);
      const texts = [];
      try {
        for (;;) {
          let next;
          try {
            next = await pieces.next();
          } catch (e) {
            // 전처리에 실패하면(아주 옛날 브라우저 등) 원본으로라도 진행
            console.warn("이미지 전처리 실패 — 원본으로 인식 진행", e);
            return recognize(image, progress);
          }
          if (next.done) return texts.join("\n");
          const { canvas, top, bottom, total } = next.value;
          try {
            // 조각이 여럿이면 그림 전체에서의 진행률로 환산
            const onPct = progress && ((pct) => progress(Math.round(((top + ((bottom - top) * pct) / 100) / total) * 100)));
            texts.push(await recognize(canvas, onPct));
          } finally {
            releaseCanvas(canvas);
          }
        }
      } finally {
        await pieces.return(); // 중간에 실패해도 원본 비트맵 정리
      }
    },
    terminate: () => worker.terminate(),
  };
}

/**
 * 미리보기용으로 작게 줄인 그림의 objectURL (다 쓰면 URL.revokeObjectURL로 정리).
 * 원본을 그대로 <img>에 넣으면 칸마다 원본 크기로 풀려(아이폰 캡쳐 한 장 ≈ 12MB) 여러 장일 때 메모리를 크게 차지합니다.
 * 아주 긴 캡쳐는 윗부분만 씁니다.
 * @param {File|Blob} image
 * @returns {Promise<string|null>} 만들지 못하면 null
 */
export async function makeThumbnail(image) {
  const bitmap = await loadBitmap(image);
  try {
    const scale = Math.min(1, THUMB_WIDTH / bitmap.width);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.min(Math.round(bitmap.height * scale), w * 3));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, bitmap.width, h / scale, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    releaseCanvas(canvas);
    return blob ? URL.createObjectURL(blob) : null;
  } finally {
    if (bitmap.close) bitmap.close();
  }
}

/**
 * 캡쳐를 OCR이 읽기 좋게 손질한 캔버스를 차례로 내줍니다. 보통은 한 조각이고,
 * 확대하면 MAX_PIXELS를 넘는 긴 캡쳐는 글자 줄 사이의 빈 곳에서 잘라 여러 조각으로 냅니다
 * (줄이지 않고 원래 확대 비율로 읽어야 작은 회색 시간·잔액 글씨를 놓치지 않음).
 * [확대 → 흑백 → 어두운 배경이면 반전 → 대비 보정]
 * @param {File|Blob|string} image
 * @returns {AsyncGenerator<{canvas: HTMLCanvasElement, top: number, bottom: number, total: number}>}
 *   top·bottom = 확대한 그림에서 이 조각이 차지하는 행 범위, total = 확대한 그림의 전체 높이
 */
async function* preprocessImage(image) {
  const bitmap = await loadBitmap(image);
  try {
    // 1) 확대: 작은 글씨일수록 확대 효과가 큼 (이미 충분히 크면 그대로)
    let scale = 1;
    if (bitmap.width < TARGET_WIDTH) scale = TARGET_WIDTH / bitmap.width;
    if (bitmap.width * scale > MAX_WIDTH) scale = MAX_WIDTH / bitmap.width;
    const w = Math.round(bitmap.width * scale);
    const total = Math.round(bitmap.height * scale);
    const maxH = Math.floor(MAX_PIXELS / w);

    for (let top = 0; top < total; ) {
      const h = Math.min(maxH, total - top);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, top / scale, bitmap.width, h / scale, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      enhance(imgData.data);
      // 마지막 조각이 아니면 아래쪽 빈 곳에서 자르고, 다음 조각은 거기서부터 (못 찾으면 그냥 끝에서)
      const cut = top + h < total ? (blankRowNearBottom(imgData) ?? h) : h;
      if (cut < h) canvas.height = cut; // 높이를 바꾸면 캔버스가 비워지므로, 손질한 픽셀은 아래에서 다시 올림
      ctx.putImageData(imgData, 0, 0);
      yield { canvas, top, bottom: top + cut, total };
      top += cut;
    }
  } finally {
    if (bitmap.close) bitmap.close();
  }
}

// [흑백 → 어두운 배경이면 반전 → 대비 보정]을 픽셀 배열(RGBA)에 그대로 적용
function enhance(px) {
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
  // 글자가 아주 적은 캡쳐(거래 몇 건 + 빈 공간)는 글자가 1%도 안 돼 lo·hi가 둘 다 배경색에 붙고,
  // 그대로 펴면 그림 전체가 한 색(검정)이 돼 아무것도 못 읽음 → 대비는 최대 2배까지만 키움(배경 반대쪽으로 범위 확보)
  if (hi - lo < 128) {
    if (invert) hi = Math.min(255, lo + 128);
    else lo = Math.max(0, hi - 128);
  }
  const range = Math.max(hi - lo, 1);

  for (let i = 0, g = 0; i < px.length; i += 4, g++) {
    let v = ((gray[g] - lo) / range) * 255;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    if (invert) v = 255 - v;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
}

// 손질한 조각(흰 배경·검은 글씨)의 아래쪽 CUT_ZONE 안에서, 위로 올라가며 처음 만나는
// '빈 띠'(글자 없는 행이 BLANK_RUN줄 이상 연속)의 가운데 행. 없으면 null
function blankRowNearBottom({ data, width, height }) {
  let run = 0;
  for (let y = height - 1; y >= Math.floor(height * (1 - CUT_ZONE)); y--) {
    if (!isBlankRow(data, width, y)) {
      run = 0;
    } else if (++run >= BLANK_RUN) {
      return y + (BLANK_RUN >> 1);
    }
  }
  return null;
}

function isBlankRow(px, width, y) {
  for (let i = y * width * 4, end = i + width * 4; i < end; i += 4) {
    if (px[i] < 200) return false;
  }
  return true;
}

// 다 쓴 캔버스의 메모리를 바로 돌려줌 (iOS Safari는 캔버스 메모리 총량에 상한이 있고, 다 쓴 캔버스도 한동안 붙잡아 둠)
function releaseCanvas(canvas) {
  canvas.width = 0;
  canvas.height = 0;
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
