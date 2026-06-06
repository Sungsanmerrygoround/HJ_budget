// ocr.js — 이미지에서 글자를 뽑아내는 OCR 담당 모듈
//
// OCR(Optical Character Recognition, 광학 문자 인식) =
//   "사진 속 글자를 컴퓨터가 읽을 수 있는 텍스트로 바꾸는 기술"
//
// 우리는 Tesseract.js라는 무료 라이브러리를 씁니다.
//  - 구글이 만든 OCR 엔진(Tesseract)을 브라우저에서 돌게 만든 것
//  - 서버도, API 키도, 결제도 필요 없음 → 전부 사용자 브라우저 안에서 처리
//  - index.html에서 <script>로 불러와서 전역(window.Tesseract)으로 존재합니다.

/**
 * 이미지에서 글자를 추출합니다.
 * @param {File|string} image  - 고른 파일 또는 이미지 URL
 * @param {(percent:number)=>void} [onProgress] - 진행률(0~100) 콜백
 * @returns {Promise<string>} 추출된 원문 텍스트
 */
export async function extractText(image, onProgress) {
  const result = await Tesseract.recognize(image, "kor+eng", {
    // logger: OCR이 진행되는 동안 상태를 계속 알려줍니다.
    logger: (m) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });

  // result.data.text 안에 인식된 전체 글자가 들어있습니다.
  return result.data.text;
}
