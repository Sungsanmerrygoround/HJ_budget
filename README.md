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
| 👨‍👩‍👧 **가족 코드 공유** | 추측 불가능한 가족 코드(hid)로 데이터를 나눠 담고, 🔗 초대 링크를 받은 가족끼리만 같은 가계부를 공유 |
| ☁️ **클라우드 동기화** | 접속하면 익명 자동 로그인 → 같은 가족 코드를 쓰는 폰·PC 어디서나 같은 데이터. 두 사람이 동시에 편집해도 유실 없이 안전(원자적 저장) |
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
Firestore  households/{hid}/budgets/{년_월}  ──▶  차트·달력·예산에 반영
```

## 📁 구조

```
snap-budget/
├─ index.html              # 앱 화면 (헤더·탭·뷰·모달 마크업)
├─ styles.css
├─ manifest.webmanifest    # PWA (홈 화면 설치 정보)
├─ sw.js                   # 서비스워커 (오프라인 캐시)
├─ firestore.rules         # Firestore 보안 규칙 (households/{hid}만 허용)
├─ icon.svg · icon-*.png   # 앱 아이콘
├─ test-*.mjs              # 순수 로직 검증 스크립트 (node로 실행)
└─ src/
   ├─ main.js              # 앱 컨트롤러 (상태·라우팅, 렌더/캡쳐 조립)
   ├─ household.js         # 가족 코드(hid) 관리 — URL ?h= → localStorage → 생성
   ├─ id.js                # 추측 불가능한 고유 id 생성 (공용)
   ├─ auth.js              # Firebase 익명 자동 로그인
   ├─ firebase.js          # Firebase 초기화
   ├─ firebase-config.js   # Firebase 설정 (apiKey는 공개 식별자라 커밋 OK)
   ├─ store.js             # Firestore 저장/조회 (households/{hid} 경로, 원자적 쓰기)
   ├─ entryops.js          # 내역 배열을 '키로 찾아' 교체/삭제하는 순수 함수
   ├─ ocr.js               # Tesseract.js OCR + 이미지 전처리
   ├─ parse.js             # OCR 원문 → 거래 구조화 (정규식 + 잔액 산수 복구)
   ├─ categorize.js        # 9종 카테고리 정의 + 가맹점 자동 분류
   ├─ capture.js           # 캡쳐 OCR 흐름 (미리보기·인식·확인·일괄 추가)
   ├─ aggregate.js         # 합계·카테고리별 통계 (한 번의 순회로 계산)
   ├─ renderer.js          # 차트·달력·목록·게이지 렌더 (순수 함수)
   ├─ datefmt.js           # 날짜 문자열 유틸
   └─ dom.js               # DOM 도우미 ($, fmt, esc, 토스트, 로딩바)
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
6. 가족과 공유하려면 헤더의 🔗 버튼으로 **초대 링크(`?h=가족코드`)를 복사**해 전달 → 링크를 연 가족은 같은 가족 코드를 채택해 같은 가계부를 공유

> 🔒 `firebaseConfig`의 apiKey는 비밀이 아니라 공개 식별자입니다. 보안은 Firestore 규칙(로그인된 요청만 허용)이 담당합니다.
> 데이터는 `households/{가족코드}` 아래로 나눠 담기며, **추측 불가능한 가족 코드(hid)를 아는 가족끼리만** 같은 가계부를 봅니다(링크 공유형 모델). 코드를 모르는 외부인은 접근할 수 없습니다.

### GitHub Pages 배포 시
- Firebase **Authentication → 설정 → 승인된 도메인**에 `<username>.github.io` 추가

---

## 💡 만들면서 배운 것

- 브라우저 OCR(Tesseract.js)로 한글 거래내역을 인식하고, **정규식으로 노이즈를 걸러 구조화**하는 과정
- OCR은 완벽하지 않으므로 **"사람이 확인·수정하는 관문"** 을 둬 데이터 품질을 확보
- **익명 로그인 + Firestore 규칙**으로, 별도 가입 없이도 "로그인된 요청만 허용"해 데이터를 보호
- apiKey는 비밀이 아니라는 점, 보안은 클라이언트 키가 아니라 **서버 규칙**에서 온다는 점
- 전역 공용에서 **`households/{가족코드}` 격리 + 링크 공유형 모델**로 옮겨, 코드를 아는 가족끼리만 공유하도록 좁힌 과정
- 문서 전체를 덮어쓰던 저장을 **용도별 원자적 연산**(추가=arrayUnion / 예산=merge / 수정·삭제=트랜잭션)으로 바꿔, 두 사람이 동시에 편집해도 유실이 없게 만든 것

---

*개인 학습/포트폴리오용 프로젝트입니다.*
