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

import { toISO, todayISO, daysInMonth, parseISO } from "./datefmt.js";

// OCR이 쉼표(,)를 마침표(.)로 잘못 읽는 일이 흔해 둘 다 천 단위 구분자로 허용
// (원화는 소수점이 없어 안전)
const AMOUNT_RE = /([-+‒–—−])?\s*([\d][\d,.]*)\s*원/; // (부호?) 숫자 "원"
// '원' 글자를 OCR이 통째로 놓친 경우의 구제용: 부호가 분명히 붙은 숫자만 인정
// (잔액은 부호가 없으니 이 패턴에 잡히지 않음)
const SIGNED_NO_WON_RE = /([-+‒–—−])\s*([\d][\d,.]*[\d])(?!\s*[:.\d%])/;
const TIME_RE = /\b(\d{1,2}):(\d{2})\b/; // 16:38

// 잔액으로 판정할 배수: 부호 없는 숫자가 직전 거래금액의 N배 이상이면 잔액으로 본다.
// (실제 잔액은 보통 거래금액의 수십~수백 배라 4배 기준은 매우 안전)
const BALANCE_RATIO = 4;

// 부호 없는 숫자가 "이미 확인된 잔액"의 이 비율 이상이면 잔액으로 본다.
// (잔액들은 서로 0.x% 차이로 뭉쳐 있어, 0.8 기준이면 큰 지출[월세 등]과도 안전히 구분)
const BALANCE_NEAR = 0.8;

// 개인 가계부 한 건이 이 금액(1억원)보다 크면, OCR이 잔액을 붙였거나
// 자릿수를 덧댄 것(예: "5,500"→"5500000000")으로 보고 최종 결과에서 제외한다.
const MAX_AMOUNT = 100000000;

// 상단 요약/안내 줄(거래가 아님)을 거르는 패턴.
// 핵심 방어는 "첫 날짜 헤더 위는 전부 무시"(startIdx)이고, 이건 날짜 헤더가 없는 화면용 보조 장치다.
// 가맹점 이름(예: "큰지출가맹점", "수입식품")을 오인해 버리지 않도록, 요약에만 나오는 문구로 좁힌다.
const SUMMARY_RE = /지난달|이번\s?달|비해|평균|쓰고\s?있|덜\s?쓰|더\s?쓰|모으고|^(소비|수입|지출|합계|총\s?지출)\s*[\d,.]+\s*원$/;

// 날짜 헤더 "6월 7일 일요일"은 요일 단어로 알아본다. OCR이 "일요 일"처럼 띄어 읽기도 하고,
// 뒤에 한글이 바로 붙으면 가맹점명("일요일카페")이며, 앞 글자가 요일이 아니면 다른 말("요기요 일시불")이다.
const WEEKDAY_RE = /[월화수목금토일]\s?요\s?일(?![가-힣])/;
// 헤더는 보통 작은 회색 글씨라 OCR이 '월'을 &·8로, '일'을 %로 잘못 읽곤 해서
// (실제로 "10월 15일 목요일" → "108 15% 목요일") 월이 같이 있으면 그런 경우도 날짜로 받아준다.
// ('일요일'의 '일'은 날짜의 '일'이 아님: "108 42 일요일"을 42일로 읽지 않게)
const MONTH_DAY_RE = /(\d{1,2})\s*[월윌&8]\s*(\d{1,2})\s*[일%](?!\s?요)/;
// '일'을 2로 읽거나 빠뜨린 헤더("10월 12일" → "108 122 월요일", "9월 30일" → "9월 302 수요일")용: 요일 바로 앞 숫자
const MONTH_NUM_RE = /(\d{1,2})\s*[월윌&8]\s*(\d{1,3})\s*(?=[월화수목금토일]\s?요\s?일)/;
// '일'만 읽힌 헤더. 월이 없으면 %는 받지 않는다("매주 금요일 5% 적립" 배너가 5일이 되지 않게)
const DAY_RE = /(\d{1,2})\s*일(?!\s?요)/;
// 결제 예정 등으로 목록에 앞으로의 날짜도 보여서, 오늘부터 이 기간 안이면 미래 날짜도 그대로 둔다
// (그보다 뒤면 작년 것: 1월에 12월 말 내역을 찍은 경우)
const FUTURE_DAYS = 45;

/**
 * @param {string} rawText OCR 원문
 * @param {{startDate?: string, now?: Date}} [opts]
 *   startDate: 첫 날짜 헤더가 나오기 전까지 쓸 날짜(YYYY-MM-DD, 없으면 오늘).
 *     여러 장을 이어 읽을 때 앞 장의 lastDate를 넘기면, 헤더가 위로 잘린 장의 윗부분 거래가 '오늘'로 잡히지 않는다.
 *   now: '오늘'로 쓸 시각(테스트용, 없으면 현재 시각)
 * @returns {{expenses: Array, incomes: Array<{amount: number, date: string}>, firstDate: string|null, lastDate: string}}
 *   incomes = 제외한 수입(개수를 알려주고, 여러 장을 합칠 때 겹친 수입을 한 번만 세는 데 사용),
 *   firstDate = 처음 읽은 '월·일' 날짜 헤더(없으면 null. 월을 못 읽은 "15일" 헤더는 앞 장에 따라 날짜가 달라져 뺌),
 *   lastDate = 끝까지 읽었을 때의 날짜(다음 장으로 이어줄 값)
 */
export function parseTransactions(rawText, opts = {}) {
  // 전각(full-width) 숫자·기호를 반각으로 정규화(NFKC): OCR이 "－５，５００원" 같은
  // 전각 문자를 내보내면 금액 정규식이 통째로 놓쳐 거래가 통째로 사라진다.
  // (반각 하이픈만 변환되고 en/em 대시는 그대로라, 아래 isMinus의 대시 처리도 유지됨)
  // 줄 끝 금액의 '원'을 OCR이 '&'로 읽는 일도 잦아("1,234,500&") 줄 끝에 한해 '원'으로 되돌린다.
  // 단, 부호가 붙었거나 천 단위 쉼표가 있는 '금액 모양' 숫자일 때만 (줄 중간의 "7&7 마트"나,
  // 줄 끝 &가 원래 글자인 "GS25 &" 같은 가맹점 줄이 25원짜리 지출이 되지 않게)
  const lines = String(rawText ?? "")
    .normalize("NFKC")
    .split("\n")
    .map((l) => l.trim().replace(/([-+‒–—−]\s*\d[\d,.]*|\d{1,3}(?:[,.]\d{3})+)\s*&$/, "$1원"))
    .filter(Boolean);

  const expenses = [];
  const incomes = [];

  const now = opts.now || new Date();
  let currentDate = opts.startDate || todayISO(now);
  let firstDate = null;
  let sawDate = false; // 날짜 헤더를 하나라도 읽었는지

  // 주의: 예전엔 "첫 날짜 헤더 위는 전부 무시"했지만, 화면을 스크롤해 캡쳐하면
  // 헤더가 위로 잘려 나가 실제 거래가 맨 위에 올 수 있다(그 거래까지 버려짐).
  // 그래서 위치로 자르지 않고, 요약 줄은 아래의 SUMMARY_RE로만 걸러낸다.
  let lastTxn = null; // 직전에 추가한 지출 (잔액·시간을 붙여주려고)
  let expectBalance = false; // 직전 줄에서 거래금액을 처리해 "잔액 차례"인지
  let lastBalance = 0; // 마지막으로 확인한 잔액 값(잔액들은 서로 비슷한 크기로 뭉쳐 있음)
  let pendingMerchant = ""; // 금액 줄에 가맹점 글자가 없을 때 쓸, 앞서 모아둔 가맹점명
  let ambiguousIdx = -1; // 부호 없이(=모호하게) 추가한 직전 지출의 expenses 내 위치(-1이면 없음)
  let ambiguousVal = 0; // 그 모호 지출의 금액(잔액 산수 검증용)

  // 읽은 순서대로 "거래/잔액" 이벤트를 기록 (마지막에 잔액 산수로 깨진 금액을 복구할 때 사용)
  // 거래내역 화면은 최신순이라: [거래A, 잔액A(거래A 후), 거래B, 잔액B(거래B 후 = 거래A 직전)]
  // → 거래A의 금액 = 잔액B − 잔액A. OCR이 금액 앞자리를 깨먹어도 이 산수로 되살릴 수 있다.
  const seq = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    // 1) 날짜 구분선? "6월 7일 일요일" (일별 합계가 붙은 "6월 7일 일요일 -7,800원"도 헤더)
    if (isDateHeader(line)) {
      // '일'만 읽힌 헤더는 앞 날짜를 기준으로 정한다 (아직 앞 날짜가 없으면 null → 오늘 기준)
      const headerDate = parseDateHeader(line, now, sawDate || opts.startDate ? currentDate : null);
      if (headerDate) {
        currentDate = headerDate;
        sawDate = true;
        if (!firstDate && monthDayOf(line)) firstDate = headerDate;
      }
      lastTxn = null;
      expectBalance = false;
      pendingMerchant = "";
      ambiguousIdx = -1;
      continue;
    }

    // 2) 상단 요약/안내 줄은 통째로 무시
    if (SUMMARY_RE.test(line)) continue;

    const m = matchAmount(line);
    const timeM = line.match(TIME_RE);
    const hasTime = !!timeM;

    if (!m) {
      // 숫자가 없는 줄: 시간만 있는 줄이면 직전 거래에 시간 붙이기
      if (hasTime) {
        if (lastTxn && !lastTxn.time) lastTxn.time = fmtTime(timeM);
        // 시간 줄 끝의 부호 없는 숫자는 잔액이다. OCR이 잔액의 '원'을 자주 놓쳐
        // 여기로 흘러오는데, 그냥 버리면 잔액 산수 복구를 못 하니 잔액으로 기록한다.
        const bare = line.match(/([\d][\d,.]{2,}[\d])\s*$/);
        if (bare) {
          const v = Number(bare[1].replace(/[,.]/g, ""));
          if (v > 0) {
            lastBalance = v;
            expectBalance = false;
            ambiguousIdx = -1;
            seq.push({ type: "bal", value: v });
          }
        }
      }
      // 그 외 글자 줄은 가맹점명 후보로 모아둔다(다음 금액 줄에 이름이 없을 때 사용)
      else addPendingMerchant(cleanMerchant(line));
      continue;
    }

    const sign = m[1]; // '-', '+', 대시 변형, 또는 undefined
    const amount = Number(m[2].replace(/[,.]/g, ""));
    const before = line.slice(0, m.index);
    const hasMerchant = /[가-힣A-Za-z]/.test(before); // 금액 앞에 가맹점 글자가 있나

    // ── 부호 있는 줄: 부호가 곧 거래 유형 ──
    if (sign === "+") {
      // 수입(입금·이자·캐시백) → 제외. 다음 잔액을 기다림.
      incomes.push({ amount, date: currentDate });
      lastTxn = null;
      expectBalance = true;
      pendingMerchant = ""; // 수입 가맹점명이 다음 지출로 새지 않도록 비움
      ambiguousIdx = -1;
      continue;
    }
    if (isMinus(sign)) {
      // 부호 있는 '확실한' 금액이 왔다. 직전에 부호 없이 넣은 모호 항목이
      // 사실은 이 거래의 잔액이었는지 산수로 검증해 되돌린다.
      reconcileAmbiguous(amount);
      addExpense(false);
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
    // (c) 가맹점 글자가 있는 부호 없는 숫자 → 부호를 놓친 지출로 인정(단, '모호'하다고 표시)
    if (hasMerchant) {
      addExpense(true);
      continue;
    }
    // (d) 부호도, 시간도, 가맹점도, 기다리던 잔액도 아닌 외톨이 숫자 → 안전하게 버림(잔액/요약일 확률 높음)
    expectBalance = false;

    // ── 내부 헬퍼 ──
    function addExpense(ambiguous) {
      // amount가 0이면 OCR이 금액 앞자리를 깨먹은 것(예: "-7,000원" → ",000원").
      // 바로 버리지 않고 0원으로 넣어두면, 마지막에 잔액 산수로 복구를 시도한다.
      const lineMerchant = cleanMerchant(before);
      const merchant = lineMerchant || pendingMerchant; // 줄에 이름 없으면 모아둔 이름 사용
      const txn = { merchant, amount, date: currentDate, time: hasTime ? fmtTime(timeM) : null };
      expenses.push(txn);
      seq.push({ type: "txn", txn });
      lastTxn = txn;
      expectBalance = true; // 이 거래의 잔액이 곧 따라올 것
      pendingMerchant = ""; // 사용했든 아니든 다음 거래로 새지 않게 비움
      // 부호 없이(모호하게) 넣은 항목이면, 나중에 잔액으로 판명될 수 있게 위치를 기억
      // (깨진 0원 금액은 잔액 검증 산수가 성립하지 않으니 제외)
      ambiguousIdx = ambiguous && amount > 0 ? expenses.length - 1 : -1;
      ambiguousVal = ambiguous && amount > 0 ? amount : 0;
    }
    // 부호 있는 확실한 금액 nextAmount가 왔을 때, 직전 모호 항목이
    // 사실 이 거래의 잔액이었는지 "이전잔액 − 모호값 == 금액"으로 검증해 되돌린다.
    function reconcileAmbiguous(nextAmount) {
      if (ambiguousIdx >= 0 && lastBalance > 0 && Math.abs(lastBalance - ambiguousVal) === nextAmount) {
        expenses.splice(ambiguousIdx, 1); // 모호 항목은 지출이 아니라 잔액이었음 → 제거
        lastBalance = ambiguousVal; // 그게 진짜 잔액이므로 기준값 갱신
        lastTxn = null;
      }
      ambiguousIdx = -1; // 부호 있는 금액이 온 시점에 모호 창은 닫힌다
      ambiguousVal = 0;
    }
    function consumeBalance() {
      // 잔액 줄에 시간이 있으면 직전 거래에 시간을 붙여준다
      if (hasTime && lastTxn && !lastTxn.time) lastTxn.time = fmtTime(timeM);
      // 잔액 줄에 가맹점 글자가 묻어 있으면 가맹점명 후보로 모아둔다
      addPendingMerchant(cleanMerchant(before));
      lastBalance = amount; // 잔액 크기 기준을 갱신
      seq.push({ type: "bal", value: amount });
      expectBalance = false;
      ambiguousIdx = -1; // 모호 항목 뒤에 정상 잔액이 왔다 = 그 항목은 진짜 지출로 확정
    }
    function addPendingMerchant(text) {
      const t = (text || "").replace(/\b\d{1,2}:\d{2}\b/g, "").trim();
      if (!t || !/[가-힣A-Za-z]/.test(t)) return; // 글자가 있어야 가맹점 후보
      pendingMerchant = pendingMerchant ? `${pendingMerchant} ${t}` : t;
    }
  }

  // ── 잔액 산수 복구 ──
  // OCR이 거래금액의 앞자리를 깨먹는 일이 있다(특히 7로 시작하는 금액:
  // "-7,000원" → ",000원"(0원), "-27,830원" → "7,830원" 등).
  // 거래내역은 최신순이라 "다음(아래) 잔액 − 이 거래의 잔액 = 진짜 거래금액"이므로,
  // 읽은 금액이 깨졌거나(0원) 기대값의 끝자리와만 일치하면(앞자리 누락) 산수로 교정한다.
  for (let i = 0; i < seq.length; i++) {
    if (seq[i].type !== "txn") continue;
    const own = seq[i + 1]; // 이 거래 직후의 잔액
    if (!own || own.type !== "bal") continue; // 자기 잔액을 모르면 복구 불가
    let next = null; // 그 다음 잔액 = 이 거래 직전의 잔액
    for (let j = i + 2; j < seq.length; j++) {
      if (seq[j].type === "bal") { next = seq[j]; break; }
    }
    if (!next) continue;
    const expected = next.value - own.value;
    // 산수가 지출로 성립하고(양수), 비상식적으로 크지 않을 때만
    if (expected <= 0 || expected > 10000000) continue;
    const t = seq[i].txn;
    if (t.amount === expected) continue;
    if (t.amount === 0 || String(expected).endsWith(String(t.amount))) {
      t.amount = expected;
    }
  }

  // 복구하지 못한 깨진(0원) 항목과, 비상식적으로 큰(잔액·자릿수 오인) 금액은 제외
  return {
    expenses: expenses.filter((e) => e.amount > 0 && e.amount <= MAX_AMOUNT),
    incomes,
    firstDate,
    lastDate: currentDate,
  };
}

// ── 도우미 ──
// 줄에서 금액을 찾습니다. 기본은 "숫자+원" 패턴이고,
// OCR이 '원'을 놓친 줄은 부호 있는 숫자(100원 이상)로 한 번 더 시도합니다.
function matchAmount(line) {
  const m = line.match(AMOUNT_RE);
  if (m) return m;
  const f = line.match(SIGNED_NO_WON_RE);
  if (!f) return null;
  // 부호 앞이 숫자면(예: "6-7", "2025-06-07") 날짜/범위이지 금액이 아님
  const prev = f.index > 0 ? line[f.index - 1] : "";
  if (/[\d)]/.test(prev)) return null;
  // 너무 작은 숫자는 금액일 가능성이 낮아 버림 (노이즈 방지)
  if (Number(f[2].replace(/[,.]/g, "")) < 100) return null;
  return f;
}

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
    .replace(/[\s,.]+$/, "") // 맨 뒤 기호 잔재 제거 (깨진 금액의 쉼표 등)
    .trim();
}

// 날짜 헤더 줄인지: 요일 단어가 있으면 헤더. 단 금액도 있으면, 요일 앞에 날짜(숫자·오늘·어제)가 있을 때만
// — 날짜를 잘못 읽은 일별 합계 헤더("6월 7잎 일요일 -7,800원")는 헤더로 건너뛰고(합계가 지출로 한 번 더 잡히지 않게),
//   "금요일 포차 -30,000원" 같은 가맹점 줄은 거래로 남긴다.
function isDateHeader(line) {
  const w = WEEKDAY_RE.exec(line);
  if (!w) return false;
  return !matchAmount(line) || /\d|오늘|어제/.test(line.slice(0, w.index));
}

// 날짜 헤더 → "YYYY-MM-DD" (못 읽으면 null).
//  - "10월 15일": 헤더엔 연도가 없어 작년·올해·내년 중 '오늘 + FUTURE_DAYS'를 넘지 않는 가장 늦은 날로 본다.
//    (10월에 본 "10월 25일" 결제 예정은 올해, 1월에 본 "12월 30일"은 작년, 12월 31일에 본 "1월 1일"은 내년)
//  - "15일"(월을 못 읽음): 목록은 최신순이라 앞 날짜(prevISO)보다 늦을 수 없으니, 그 이전의 가장 가까운 15일.
//    앞 날짜가 없으면 내일을 기준으로 (기기 시계·시간대 차이 하루는 봐줌)
// OCR이 숫자를 잘못 읽어 생긴 없는 날짜(2월 30일 등)는 날짜로 쓰지 않는다.
function parseDateHeader(line, now, prevISO) {
  const md = monthDayOf(line);
  if (md) {
    const [month, day] = md;
    if (month < 1 || month > 12) return null;
    const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + FUTURE_DAYS);
    for (let year = now.getFullYear() + 1; year >= now.getFullYear() - 1; year--) {
      if (day >= 1 && day <= daysInMonth(year, month) && new Date(year, month - 1, day) <= limit) {
        return toISO(year, month, day);
      }
    }
    return null;
  }
  const dm = line.match(DAY_RE);
  if (!dm) return null;
  const day = Number(dm[1]);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const prev = parseISO(prevISO) || parseISO(todayISO(tomorrow));
  let { year, month } = prev;
  if (day > prev.day) {
    month--;
    if (month === 0) { month = 12; year--; }
  }
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return toISO(year, month, day);
}

// 헤더의 [월, 일] (월이 안 보이면 null). '일'이 안 보이면 요일 바로 앞 숫자를 쓰는데,
// 31 이하면 '일'이 빠진 것으로 보고 그대로, 넘으면 끝의 2를 '일'로 보고 뗀다 (122 → 12일, 302 → 30일, 42 → 4일)
function monthDayOf(line) {
  const md = line.match(MONTH_DAY_RE);
  if (md) return [Number(md[1]), Number(md[2])];
  const mn = line.match(MONTH_NUM_RE);
  if (!mn) return null;
  const n = Number(mn[2]);
  if (n <= 31) return [Number(mn[1]), n];
  return mn[2].endsWith("2") ? [Number(mn[1]), Number(mn[2].slice(0, -1))] : null;
}
