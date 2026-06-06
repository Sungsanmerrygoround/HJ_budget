// parse.js — OCR 원문(글자 덩어리)을 거래 항목 배열로 구조화합니다.
//
// 들어옴: OCR이 뽑은 한 덩어리 텍스트(여러 줄)
// 나감:   [{ merchant, amount, date, time }, ...]  (지출만)
//
// 토스 거래내역의 규칙을 이용합니다:
//   - 지출 금액:  "-188,480원"   (앞에 마이너스 부호)
//   - 수입 금액:  "+50,000원"    (앞에 플러스 부호) → 제외!
//   - 잔액:       "975,950원"    (부호 없음)        → 무시
//   => "부호 + 숫자 + 원" 패턴이 거래 금액. 그중 마이너스(-)만 지출.

// 부호(-,+ 그리고 OCR이 자주 헷갈리는 — − 대시들) + 금액 + "원"
const AMOUNT_RE = /([-+‒–—−])\s*([\d,]+)\s*원/;

// 시간 "16:38"
const TIME_RE = /(\d{1,2}):(\d{2})/;

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
  let excludedIncome = 0; // 제외한 수입 건수 (사용자에게 알려주려고)

  // 날짜 구분선을 만나기 전 항목들은 일단 '오늘'로 둡니다 (나중에 5단계에서 수정 가능)
  const now = new Date();
  let currentDate = toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
  let lastTxn = null; // 직전에 추가한 거래 (시간 줄을 붙여주기 위해)

  for (const line of lines) {
    // 1) 날짜 구분선? "6월 4일 목요일" 처럼 '요일'이 들어있음
    if (line.includes("요일")) {
      currentDate = parseDateHeader(line, now) ?? currentDate;
      lastTxn = null;
      continue;
    }

    // 2) 거래 줄? (부호+금액+원)
    const m = line.match(AMOUNT_RE);
    if (m) {
      const sign = m[1];
      const amount = Number(m[2].replace(/,/g, ""));
      const isIncome = sign === "+"; // 플러스면 수입

      if (isIncome || amount === 0) {
        excludedIncome++; // 수입(입금·이자)은 제외
        lastTxn = null;
        continue;
      }

      const merchant = cleanMerchant(line.slice(0, m.index));
      const txn = { merchant, amount, date: currentDate, time: null };
      expenses.push(txn);
      lastTxn = txn;
      continue;
    }

    // 3) 시간 줄? → 직전 거래에 붙임
    const t = line.match(TIME_RE);
    if (t && lastTxn && !lastTxn.time) {
      lastTxn.time = `${t[1].padStart(2, "0")}:${t[2]}`;
    }
  }

  return { expenses, excludedIncome };
}

// ---- 도우미 함수들 ----

// 가맹점명에서 아이콘/기호 노이즈를 최대한 걷어냅니다.
// (OCR이 동그란 아이콘을 ©, (>, = 같은 기호로 잘못 읽는 경우가 많음)
function cleanMerchant(s) {
  let m = s
    .replace(/[©®@*•·"'|=<>~]/g, " ") // 기호 노이즈 제거
    .replace(/\s+/g, " ")
    .trim();

  // 맨 앞 1~3자 영문 노이즈(예: "po", "A") 제거
  m = m.replace(/^[a-zA-Z]{1,3}\b\s*/, "").trim();

  // 맨 앞에 남은 기호/괄호 잔재 제거 — 단, 진짜 "(주)" "(유)"는 보존
  if (!/^\((주|유)\)/.test(m)) {
    m = m.replace(/^[^가-힣\d]+/, "").trim();
  }
  return m;
}

// 날짜 구분선에서 월/일을 뽑아 ISO(YYYY-MM-DD)로 만듭니다. 실패하면 null.
function parseDateHeader(line, now) {
  // 깔끔한 경우: "6월 4일"
  let mo, day;
  const clean = line.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (clean) {
    mo = Number(clean[1]);
    day = Number(clean[2]);
  } else {
    // OCR이 '월'을 놓친 경우(예: "62 3일"): "X일" 앞 숫자를 일로, 월은 이번 달로 추정
    const dm = line.match(/(\d{1,2})\s*일/);
    if (!dm) return null;
    day = Number(dm[1]);
    mo = now.getMonth() + 1;
  }
  if (!mo || !day) return null;
  return toISO(now.getFullYear(), mo, day);
}

function toISO(year, month, day) {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}
