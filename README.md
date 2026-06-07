# 📸 snap-budget

> **사용내역 캡쳐 한 장으로 입력하는 가계부.**
> 카드·페이 거래내역 스크린샷을 올리면 브라우저에서 글자를 읽어(OCR) 여러 건을 한 번에 자동 입력합니다.

기존에 손으로 일일이 타이핑하던 가계부를, **"캡쳐 → 자동 입력"** 으로 바꾼 개인 프로젝트입니다.
API 키·서버·결제 없이 **전부 무료**로 동작합니다.

---

## ✨ 주요 기능

| 기능 | 설명 |
|------|------|
| 📷 **캡쳐 OCR 자동입력** | 거래내역 스크린샷 → 글자 인식 → 가맹점·금액·날짜를 자동 추출, 여러 건 일괄 등록 |
| 🏷️ **자동 카테고리 분류** | 가맹점명 기반 규칙으로 외식비·생필품·교통비 등 자동 분류 (수정 가능) |
| 🧠 **학습형 분류** | 사용자가 카테고리를 고치면 그 가맹점을 기억해, 다음 캡쳐부터 자동 적용 (쓸수록 정확해짐) |
| 🚫 **수입 자동 제외** | 입금·이자 등 `+` 거래는 지출 통계에서 자동 제외 |
| ♻️ **중복 거래 방지** | 같은 캡쳐를 다시 올려도 날짜+가맹점+금액이 같은 건은 자동으로 건너뜀 |
| 🗓️ **월별 관리** | 월 탭으로 월마다 따로 관리, 캡쳐 항목은 날짜에 맞는 월로 자동 분류 저장 |
| 🎯 **예산 + 잔여 예산 바** | 월 예산 설정, 사용률(%)·초과 경고 색상 표시 |
| 📊 **차트** | 카테고리별 지출 도넛 차트 + 막대 상세 |
| 📅 **달력 뷰** | 일별 소비 금액을 달력에서 한눈에 |
| ✏️ **수정/삭제** | 내역 탭해서 카테고리·내용·금액·날짜 수정 |
| ☁️ **클라우드 동기화** | 접속만 하면 익명 자동 로그인 → 가족 모두 폰·PC 어디서나 같은 데이터 |
| 📱 **PWA** | 홈 화면에 앱처럼 설치 + 기본 오프라인 |

---

## 🛠️ 기술 스택

- **Frontend**: 순수 HTML / CSS / JavaScript (ES Modules, 빌드 도구 없음)
- **OCR**: [Tesseract.js](https://tesseract.projectnaptha.com/) — 브라우저 안에서 도는 무료 한글 OCR
- **차트**: Chart.js
- **백엔드/DB**: Firebase Authentication + Cloud Firestore
- **배포**: GitHub Pages
- **PWA**: Web App Manifest + Service Worker

> 별도 서버가 없는 **순수 클라이언트 앱**입니다.

---

## 🧩 동작 흐름

```
캡쳐 업로드
   │  Tesseract.js (브라우저 OCR)
   ▼
원문 텍스트
   │  parse.js  ── "부호+금액+원" 패턴으로 거래 추출, 수입(+) 제외, 날짜/시간 매칭
   ▼
[{가맹점, 금액, 날짜}]
   │  categorize.js ── 가맹점명 → 카테고리
   ▼
확인·수정 목록
   │  날짜가 속한 '월'로 그룹핑
   ▼
Firestore  users/{uid}/budgets/{년_월}  ──▶  차트·달력·예산에 반영
```

## 📁 구조

```
snap-budget/
├─ index.html              # 앱 화면
├─ styles.css
├─ manifest.webmanifest    # PWA
├─ sw.js                   # 서비스워커
├─ icon.svg
└─ src/
   ├─ main.js              # 앱 컨트롤러 (탭·예산·차트·달력·수정·캡쳐 조립)
   ├─ ocr.js               # Tesseract.js OCR
   ├─ parse.js             # OCR 원문 → 거래 구조화 (정규식)
   ├─ categorize.js        # 카테고리 정의 + 자동 분류
   ├─ store.js             # Firestore 월별 저장/조회 (가족 공용 경로)
   ├─ auth.js              # 익명 자동 로그인
   ├─ firebase.js          # Firebase 초기화
   └─ firebase-config.js   # Firebase 설정 (apiKey는 공개 식별자라 커밋 OK)
```

---

## 🚀 직접 만들어 쓰려면

1. 이 저장소를 클론
2. [Firebase 콘솔](https://console.firebase.google.com)에서 프로젝트 생성
   - **Authentication → 로그인 방법 → 익명(Anonymous)** 사용 설정
   - **Firestore Database** 생성 후 `firestore.rules`의 규칙을 붙여넣고 게시
3. `src/firebase-config.js`의 값을 본인 Firebase 웹앱 설정으로 교체
4. 정적 서버로 실행 (ES Module은 `file://`에서 막힘):
   ```bash
   npx serve -p 3000     # 또는: python -m http.server 3000
   ```
5. 브라우저에서 `http://localhost:3000` → 접속하면 익명 로그인되어 바로 사용

> 🔒 `firebaseConfig`의 apiKey는 비밀이 아니라 공개 식별자입니다. 보안은 Firestore 규칙(로그인된 요청만 허용)이 담당합니다.
> 가족끼리 공용 데이터를 공유하는 구조라, 접속한 사람은 같은 가계부를 함께 봅니다.

### GitHub Pages 배포 시
- Firebase **Authentication → 설정 → 승인된 도메인**에 `<username>.github.io` 추가

---

## 💡 만들면서 배운 것

- 브라우저 OCR(Tesseract.js)로 한글 거래내역을 인식하고, **정규식으로 노이즈를 걸러 구조화**하는 과정
- OCR은 완벽하지 않으므로 **"사람이 확인·수정하는 관문"** 을 둬 데이터 품질을 확보
- **익명 로그인 + Firestore 규칙**으로, 별도 가입 없이도 "로그인된 요청만 허용"해 가족 공용 데이터를 보호
- apiKey는 비밀이 아니라는 점, 보안은 클라이언트 키가 아니라 **서버 규칙**에서 온다는 점

---

*개인 학습/포트폴리오용 프로젝트입니다.*
