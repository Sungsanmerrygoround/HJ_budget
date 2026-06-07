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

// 상단 요약/안내 줄(거래가 아님)
const SUMMARY_RE = /(소비|지출|수입|지난달|이번\s?달|비해|평균|합계|총\s?지출|더\s?쓰|덜\s?쓰|모으|남은)/;

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

  for (let idx = startIdx; idx < lines.length; idx++) {
    const line = lines[idx];

    // 1) 날짜 구분선? "6월 7일 일요일"
    if (line.includes("요일")) {
      currentDate = parseDateHeader(line, now) ?? currentDate;
      lastTxn = null;
      expectBalance = false;
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
    // (b) 직전에 거래금액을 추가했고, 이번 숫자가 그 금액보다 훨씬 큼 → 잔액
    if (expectBalance && lastTxn && amount >= lastTxn.amount * BALANCE_RATIO) {
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
      const txn = { merchant: cleanMerchant(before), amount, date: currentDate, time: hasTime ? fmtTime(timeM) : null };
      expenses.push(txn);
      lastTxn = txn;
      expectBalance = true; // 이 거래의 잔액이 곧 따라올 것
    }
    function consumeBalance() {
      // 잔액 줄에 시간이 있으면 직전 거래에 시간을 붙여준다
      if (hasTime && lastTxn && !lastTxn.time) lastTxn.time = fmtTime(timeM);
      expectBalance = false;
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
