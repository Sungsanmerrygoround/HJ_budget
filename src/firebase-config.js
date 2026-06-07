// Firebase 프로젝트 설정값.
// apiKey 등은 "비밀"이 아니라 공개되는 식별자입니다 (Firebase 공식 문서 기준).
// 보안은 Firestore 규칙이 담당하므로 이 파일은 그대로 커밋해도 됩니다.
//
// 채우는 곳: Firebase 콘솔 → 프로젝트 설정(⚙️) → 일반 → 내 앱 → 웹앱(</>)

export const firebaseConfig = {
  apiKey: "AIzaSyCrExzgZ40Lzi7z01fFl3JGUF2mP_hov1I",
  authDomain: "snap-budget-c52e9.firebaseapp.com",
  projectId: "snap-budget-c52e9",
  storageBucket: "snap-budget-c52e9.firebasestorage.app",
  messagingSenderId: "749022134037",
  appId: "1:749022134037:web:f5e1660c8c72837330331c",
};

export const isConfigured = !Object.values(firebaseConfig).includes("REPLACE_ME");
