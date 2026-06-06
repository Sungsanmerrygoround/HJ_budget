// 📋 설정 템플릿 (이 파일은 GitHub에 올라갑니다 — 비밀값 없음)
//
// 사용법:
//   1) 이 파일을 복사해서 같은 폴더에 firebase-config.js 로 저장
//   2) 아래 REPLACE_ME 값들을 본인 Firebase 프로젝트 값으로 채우기
//   3) firebase-config.js 는 .gitignore에 의해 자동으로 커밋에서 제외됩니다

export const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};

// 로그인 화면 없이 자동 로그인할 가족 공용 계정
export const familyAccount = {
  email: "REPLACE_ME",
  password: "REPLACE_ME",
};

export const isConfigured =
  !Object.values(firebaseConfig).includes("REPLACE_ME") &&
  !Object.values(familyAccount).includes("REPLACE_ME");
