// parse.js — OCR 원문(글자 덩어리)을 거래 항목 배열로 구조화합니다.
//
// 은행/페이 거래내역 화면의 구조를 이용합니다:
//   [가맹점 ............ 금액]   ← 거래 줄 (사람이 읽는 가맹점 이름 + 거래금액)
//   [시간(HH:MM) ...... 잔액]   ← 잔액 줄 (남은 돈)
//
// 핵심 아이디어(부호에 의존하지 않음):
//   - "가맹점 글자가 있는 줄"이면 거래로 본다 (OCR이 마이너스(−)를 놓쳐도 인식)
//   - "시간 + 숫자만 있는 줄"은 잔액으로 보고 버린다
//   - 금액 앞 부호가 '+'면 수입(입금·이자)이므로 제외

const AMOUNT_RE = /([-+‒–—−])?\s*([\d][\d,]*)\s*원/; // (부호?) 숫자 "원"
const TIME_RE = /\b(\d{1,2}):(\d{2})\b/; // 16:38

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
  let lastTxn = null; // 직전 거래 (시간/잔액 줄을 붙여주려고)

  for (const line of lines) {
    // 1) 날짜 구분선? "6월 2일 화요일" 처럼 '요일' 포함
    if (line.includes("요일")) {
      currentDate = parseDateHeader(line, now) ?? currentDate;
      lastTxn = null;
      continue;
    }

    const m = line.match(AMOUNT_RE);
    const timeM = line.match(TIME_RE);
    const hasTime = !!timeM;

    if (m) {
      const sign = m[1]; // '-', '+', 대시 변형, 또는 undefined
      const before = line.slice(0, m.index);
      const hasMerchant = /[가-힣A-Za-z]/.test(before); // 금액 앞에 가맹점 글자가 있나
      const isPlus = sign === "+";

      // 잔액 줄로 보이는 경우: 시간이 있고, 부호도 없고, 앞에 가맹점 글자도 없음
      const looksLikeBalance = hasTime && !sign && !hasMerchant;

      // 거래 줄: 잔액이 아니고, (부호가 있거나 가맹점 글자가 있음)
      if (!looksLikeBalance && (sign || hasMerchant)) {
        const amount = Number(m[2].replace(/,/g, ""));
        if (isPlus || amount === 0) {
          excludedIncome++; // 수입(+)·0원 제외
          lastTxn = null;
        } else {
          const txn = { merchant: cleanMerchant(before), amount, date: currentDate, time: null };
          if (hasTime) txn.time = fmtTime(timeM); // 거래 줄에 시간이 같이 있으면 바로 사용
          expenses.push(txn);
          lastTxn = txn;
        }
        continue;
      }
    }

    // 2) 시간/잔액 줄 → 직전 거래에 시간 붙임
    if (hasTime && lastTxn && !lastTxn.time) {
      lastTxn.time = fmtTime(timeM);
    }
  }

  return { expenses, excludedIncome };
}

// ── 도우미 ──
function fmtTime(timeM) {
  return `${timeM[1].padStart(2, "0")}:${timeM[2]}`;
}

// 가맹점명에서 아이콘/기호 노이즈를 걷어냅니다.
// (영문 앞글자 AK·GS·CU·KB 등은 실제 이름일 수 있어 보존)
function cleanMerchant(s) {
  return s
    .replace(/[©®@*•·"'|=<>~]/g, " ") // 기호 노이즈 제거
    .replace(/\s+/g, " ")
    .replace(/^[^가-힣\dA-Za-z(]+/, "") // 맨 앞 기호 잔재 제거 (글자/숫자/'(' 전까지)
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
