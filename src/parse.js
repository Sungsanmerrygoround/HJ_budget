// parse.js — OCR 원문(글자 덩어리)을 거래 항목 배열로 구조화합니다.
//
// 은행/페이 거래내역 화면의 구조(카카오페이·토스 등)를 이용합니다:
//   [가맹점 ............ 거래금액(±)]   ← 거래 줄
//   [시간(HH:MM) ........ 잔액]        ← 잔액 줄 (남은 돈, 부호 없음, 거래금액보다 훨씬 큼)
//
// 한 거래는 보통 "거래금액 + 잔액" 두 숫자가 쌍을 이룹니다.
// 잔액은 (1) 부호가 없고 (2) 직전 거래금액보다 훨씬 크다는 특징으로 구분합니다.
//
// 핵심 규칙:
//   - 부호 '+' → 수입(입금·이자·캐시백) → 제외
//   - 부호 '-' → 지출 → 추가, 그리고 "다음 잔액"을 기다림
//   - 부호가 없어도 가맹점 글자가 있으면 지출로 인정(OCR이 '-'를 놓친 경우)
//   - 단, 직전에 거래금액을 막 추가했고 이번 숫자가 그 금액보다 훨씬 크면 → 잔액으로 보고 버림
//   - 화면 맨 위 요약(소비/지난달 등)·날짜 헤더는 거래에서 제외

const AMOUNT_RE = /([-+‒–—−])?\s*([\d][\d,]*)\s*원/; // (부호?) 숫자 "원"
const TIME_RE = /\b(\d{1,2}):(\d{2})\b/; // 16:38

// 잔액으로 판정할 배수: 부호 없는 숫자가 직전 거래금액의 N배 이상이면 잔액으로 본다.
// (실제 잔액은 보통 거래금액의 수십~수백 배라 4배 기준은 매우 안전)
const BALANCE_RATIO = 4;

// 부호 없는 숫자가 "이미 확인된 잔액"의 이 비율 이상이면 잔액으로 본다.
// (잔액들은 서로 0.x% 차이로 뭉쳐 있어, 0.8 기준이면 큰 지출[월세 등]과도 안전히 구분)
const BALANCE_NEAR = 0.8;

// 상단 요약/안내 줄(거래가 아님)을 거르는 패턴.
// 핵심 방어는 "첫 날짜 헤더 위는 전부 무시"(startIdx)이고, 이건 날짜 헤더가 없는 화면용 보조 장치다.
// 가맹점 이름(예: "큰지출가맹점", "수입식품")을 오인해 버리지 않도록, 요약에만 나오는 문구로 좁힌다.
const SUMMARY_RE = /지난달|비해|평균|쓰고\s?있|덜\s?쓰|더\s?쓰|모으고|^(소비|수입|지출|합계|총\s?지출)\s*[\d,]+\s*원$/;

/**
 * @param {string} rawText OCR 원문
 * @returns {{expenses: Array, excludedIncome: number}}
 */
export function parseTransactions(rawText) {
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const expenses = [];
  let excludedIncome = 0;

  const now = new Date();
  let currentDate = toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());

  // 날짜 헤더가 등장하면, 그 위(상단 요약 영역)는 모두 무시한다.
  const firstDateIdx = lines.findIndex((l) => l.includes("요일"));
  const startIdx = firstDateIdx >= 0 ? firstDateIdx : 0;

  let lastTxn = null; // 직전에 추가한 지출 (잔액·시간을 붙여주려고)
  let expectBalance = false; // 직전 줄에서 거래금액을 처리해 "잔액 차례"인지
  let lastBalance = 0; // 마지막으로 확인한 잔액 값(잔액들은 서로 비슷한 크기로 뭉쳐 있음)
  let pendingMerchant = ""; // 금액 줄에 가맹점 글자가 없을 때 쓸, 앞서 모아둔 가맹점명

  for (let idx = startIdx; idx < lines.length; idx++) {
    const line = lines[idx];

    // 1) 날짜 구분선? "6월 7일 일요일"
    if (line.includes("요일")) {
      currentDate = parseDateHeader(line, now) ?? currentDate;
      lastTxn = null;
      expectBalance = false;
      pendingMerchant = "";
      continue;
    }

    // 2) 상단 요약/안내 줄은 통째로 무시
    if (SUMMARY_RE.test(line)) continue;

    const m = line.match(AMOUNT_RE);
    const timeM = line.match(TIME_RE);
    const hasTime = !!timeM;

    if (!m) {
      // 숫자가 없는 줄: 시간만 있는 줄이면 직전 거래에 시간 붙이기
      if (hasTime && lastTxn && !lastTxn.time) lastTxn.time = fmtTime(timeM);
      // 그 외 글자 줄은 가맹점명 후보로 모아둔다(다음 금액 줄에 이름이 없을 때 사용)
      else if (!hasTime) addPendingMerchant(cleanMerchant(line));
      continue;
    }

    const sign = m[1]; // '-', '+', 대시 변형, 또는 undefined
    const amount = Number(m[2].replace(/,/g, ""));
    const before = line.slice(0, m.index);
    const hasMerchant = /[가-힣A-Za-z]/.test(before); // 금액 앞에 가맹점 글자가 있나

    // ── 부호 있는 줄: 부호가 곧 거래 유형 ──
    if (sign === "+") {
      // 수입(입금·이자·캐시백) → 제외. 다음 잔액을 기다림.
      excludedIncome++;
      lastTxn = null;
      expectBalance = true;
      pendingMerchant = ""; // 수입 가맹점명이 다음 지출로 새지 않도록 비움
      continue;
    }
    if (isMinus(sign)) {
      addExpense();
      continue;
    }

    // ── 부호 없는 줄: 잔액인지, 부호 놓친 지출인지 판별 ──
    // (a) 시간이 같이 있는 부호 없는 숫자 → 잔액
    if (hasTime) {
      consumeBalance();
      continue;
    }
    // (b) 거래(수입·지출)를 막 처리한 직후의, 가맹점 글자 없는 부호 없는 숫자 → 그 거래의 잔액
    //     (수입 캐시백 등 lastTxn이 없는 경우의 잔액도 여기서 잡아 잔액 기준값을 세운다)
    if (expectBalance && !hasMerchant) {
      consumeBalance();
      continue;
    }
    // (b-비율) 직전에 거래금액을 추가했고, 이번 숫자가 그 금액보다 훨씬 큼 → 잔액
    if (expectBalance && lastTxn && amount >= lastTxn.amount * BALANCE_RATIO) {
      consumeBalance();
      continue;
    }
    // (b2) 이미 확인된 잔액과 비슷한 크기(80% 이상) → 잔액.
    //      잔액들은 서로 거의 같은 값으로 뭉쳐 있어, 그 크기대 숫자는 지출 금액일 수 없다.
    //      (OCR이 줄 순서를 뒤섞어 잔액이 금액보다 먼저 읽혀도 안전하게 거른다)
    if (lastBalance > 0 && amount >= lastBalance * BALANCE_NEAR) {
      consumeBalance();
      continue;
    }
    // (c) 가맹점 글자가 있는 부호 없는 숫자 → 부호를 놓친 지출로 인정
    if (hasMerchant) {
      addExpense();
      continue;
    }
    // (d) 부호도, 시간도, 가맹점도, 기다리던 잔액도 아닌 외톨이 숫자 → 안전하게 버림(잔액/요약일 확률 높음)
    expectBalance = false;

    // ── 내부 헬퍼 ──
    function addExpense() {
      if (amount === 0) {
        expectBalance = false;
        return;
      }
      const lineMerchant = cleanMerchant(before);
      const merchant = lineMerchant || pendingMerchant; // 줄에 이름 없으면 모아둔 이름 사용
      const txn = { merchant, amount, date: currentDate, time: hasTime ? fmtTime(timeM) : null };
      expenses.push(txn);
      lastTxn = txn;
      expectBalance = true; // 이 거래의 잔액이 곧 따라올 것
      pendingMerchant = ""; // 사용했든 아니든 다음 거래로 새지 않게 비움
    }
    function consumeBalance() {
      // 잔액 줄에 시간이 있으면 직전 거래에 시간을 붙여준다
      if (hasTime && lastTxn && !lastTxn.time) lastTxn.time = fmtTime(timeM);
      // 잔액 줄에 가맹점 글자가 묻어 있으면 가맹점명 후보로 모아둔다
      addPendingMerchant(cleanMerchant(before));
      lastBalance = amount; // 잔액 크기 기준을 갱신
      expectBalance = false;
    }
    function addPendingMerchant(text) {
      const t = (text || "").replace(/\b\d{1,2}:\d{2}\b/g, "").trim();
      if (!t || !/[가-힣A-Za-z]/.test(t)) return; // 글자가 있어야 가맹점 후보
      pendingMerchant = pendingMerchant ? `${pendingMerchant} ${t}` : t;
    }
  }

  return { expenses, excludedIncome };
}

// ── 도우미 ──
function isMinus(sign) {
  return sign === "-" || sign === "‒" || sign === "–" || sign === "—" || sign === "−";
}

function fmtTime(timeM) {
  return `${timeM[1].padStart(2, "0")}:${timeM[2]}`;
}

// 가맹점명에서 아이콘/기호 노이즈를 걷어냅니다.
// (영문 앞글자 AK·GS·CU·KB 등은 실제 이름일 수 있어 보존)
function cleanMerchant(s) {
  return s
    .replace(/[©®@*•·"'|=<>~]/g, " ") // 기호 노이즈 제거
    .replace(/\b\d{1,2}:\d{2}\b/g, " ") // 줄에 끼어든 시간 제거
    .replace(/\s+/g, " ")
    .replace(/^[^가-힣\dA-Za-z(]+/, "") // 맨 앞 기호 잔재 제거
    .trim();
}

function parseDateHeader(line, now) {
  let mo, day;
  const clean = line.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (clean) {
    mo = Number(clean[1]);
    day = Number(clean[2]);
  } else {
    const dm = line.match(/(\d{1,2})\s*일/);
    if (!dm) return null;
    day = Number(dm[1]);
    mo = now.getMonth() + 1;
  }
  if (!mo || !day) return null;
  return toISO(now.getFullYear(), mo, day);
}

function toISO(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
