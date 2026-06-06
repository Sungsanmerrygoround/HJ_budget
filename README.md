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
| 🚫 **수입 자동 제외** | 입금·이자 등 `+` 거래는 지출 통계에서 자동 제외 |
| 🗓️ **월별 관리** | 월 탭으로 월마다 따로 관리, 캡쳐 항목은 날짜에 맞는 월로 자동 분류 저장 |
| 🎯 **예산 + 잔여 예산 바** | 월 예산 설정, 사용률(%)·초과 경고 색상 표시 |
| 📊 **차트** | 카테고리별 지출 도넛 차트 + 막대 상세 |
| 📅 **달력 뷰** | 일별 소비 금액을 달력에서 한눈에 |
| ✏️ **수정/삭제** | 내역 탭해서 카테고리·내용·금액·날짜 수정 |
| ☁️ **클라우드 동기화** | 가족 공용 계정 자동 로그인 → 폰·PC 어디서나 같은 데이터 |
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
   ├─ store.js             # Firestore 월별 저장/조회
   ├─ auth.js              # 가족 공용 계정 자동 로그인
   ├─ firebase.js          # Firebase 초기화
   └─ firebase-config.example.js  # 설정 템플릿 (실제 키는 gitignore)
```

---

## 🚀 직접 실행하기

1. 이 저장소를 클론
2. [Firebase 콘솔](https://console.firebase.google.com)에서 프로젝트 생성
   - **Authentication → 이메일/비밀번호** 사용 설정
   - **Firestore Database** 생성 후 아래 규칙 게시:
     ```
     rules_version = '2';
     service cloud.firestore {
       match /databases/{database}/documents {
         match /users/{uid}/{document=**} {
           allow read, write: if request.auth != null && request.auth.uid == uid;
         }
       }
     }
     ```
3. `src/firebase-config.example.js`를 복사해 `src/firebase-config.js`로 만들고 값 채우기
   (Firebase 웹앱 설정값 + 자동 로그인용 가족 계정 이메일/비번)
4. 정적 서버로 실행 (ES Module은 `file://`에서 막힘):
   ```bash
   npx serve -p 3000     # 또는: python -m http.server 3000
   ```
5. 브라우저에서 `http://localhost:3000`

> 🔒 `src/firebase-config.js`에는 가족 계정 비밀번호가 들어가므로 **`.gitignore`로 커밋에서 제외**됩니다.
> 공개 저장소에는 `firebase-config.example.js` 템플릿만 올라갑니다.

### GitHub Pages 배포 시
- Firebase **Authentication → 설정 → 승인된 도메인**에 `<username>.github.io` 추가

---

## 💡 만들면서 배운 것

- 브라우저 OCR(Tesseract.js)로 한글 거래내역을 인식하고, **정규식으로 노이즈를 걸러 구조화**하는 과정
- OCR은 완벽하지 않으므로 **"사람이 확인·수정하는 관문"** 을 둬 데이터 품질을 확보
- Firestore 보안 규칙으로 **본인 데이터만 접근**하도록 설계
- 클라이언트 비밀(가족 계정)은 완벽히 숨길 수 없으므로 **gitignore + 템플릿** 전략으로 분리

---

*개인 학습/포트폴리오용 프로젝트입니다.*
