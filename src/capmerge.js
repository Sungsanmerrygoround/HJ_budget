// capmerge.js — 캡쳐 여러 장의 인식 결과를 하나의 지출 목록으로 합칩니다. (순수 함수라 node로 테스트 가능)
//
// 긴 거래내역은 스크롤하며 여러 장으로 찍기 때문에, 장마다 따로 읽으면 두 가지가 틀어집니다:
//   1) 날짜: 둘째 장부터는 맨 위 날짜 헤더가 앞 장으로 잘려 나가, 윗부분 거래가 '오늘'로 잡힘
//      → 화면 순서대로 읽으며 앞 장의 마지막 날짜를 이어받는다.
//   2) 중복: 스크롤 경계의 거래가 앞 장 아래와 다음 장 위에 두 번 찍혀 지출이 두 배로 잡힘
//      → 다른 장에 이미 있는 같은 거래(같은 날 + entryops.sameTxn)는 한 번만 남긴다. (제외한 수입 개수도 같은 방식)
//
// 화면 순서는 고른 순서가 아니라 내용으로 정합니다(갤러리·파일 창마다 넘겨주는 순서가 제각각이라).
// 거래내역은 최신순이므로, 첫 날짜 헤더가 더 최신인 장이 더 위쪽 화면입니다.

import { parseTransactions } from "./parse.js";
import { sameTxn, pairUp } from "./entryops.js";

// 화면 순서를 정할 때, 첫 날짜 헤더보다 위(앞 장에서 이어지는 부분)의 거래를 알아보려고 날짜 대신 넣는 표시
const LEAD = "lead";

/**
 * @param {(string|null)[]} texts 장별 OCR 원문 (고른 순서, 인식하지 못한 장은 null)
 * @param {{now?: Date}} [opts] now: '오늘'로 쓸 시각(테스트용)
 * @returns {{
 *   expenses: Array<{merchant: string, amount: number, date: string, time: string|null, src: number, idx: number,
 *                    also: Array<{src: number, idx: number}>}>,
 *   excludedIncome: number,
 *   overlapped: number,
 * }} expenses는 화면 순서(위→아래). src = 그 지출이 나온 장의 texts 인덱스, idx = 그 장 안에서 몇 번째 지출인지
 *    (같은 원문이면 늘 같은 값이라, 사진을 더 고른 뒤 다시 합쳐도 같은 항목을 알아볼 수 있음).
 *    also = 겹쳐서 뺀 다른 장의 같은 거래들 (사진을 더 고르거나 빼서 남는 쪽이 바뀌어도 같은 항목으로 알아보는 데 사용)
 *    excludedIncome = 제외한 수입 개수(겹친 건 한 번만), overlapped = 겹쳐서 뺀 지출 개수
 */
export function mergeCaptures(texts, opts = {}) {
  // 1) 장마다 한 번 읽어 첫 날짜 헤더와 거래를 얻는다 (화면 순서를 정하는 데만 사용)
  const pages = [];
  texts.forEach((text, src) => {
    if (text == null) return;
    const r = parseTransactions(text, { now: opts.now, startDate: LEAD });
    pages.push({ src, text, first: r.firstDate, lead: r.expenses.some((e) => e.date === LEAD), items: r.expenses });
  });

  // 2) 화면 순서대로 다시 읽으며 날짜를 이어받고, 앞 장들에 이미 있는 지출·수입은 한 번만 센다
  const expenses = [];
  const incomes = [];
  let overlapped = 0;
  let startDate; // 첫 장은 parse 기본값(오늘)
  for (const page of orderPages(pages)) {
    const r = parseTransactions(page.text, { now: opts.now, startDate });
    startDate = r.lastDate;
    const items = r.expenses.map((e, idx) => ({ ...e, src: page.src, idx, also: [] }));
    const { fresh, pairs } = pairUp(expenses, items, sameDayTxn);
    for (const [kept, dup] of pairs) kept.also.push({ src: dup.src, idx: dup.idx }, ...dup.also);
    expenses.push(...fresh);
    overlapped += pairs.length;
    incomes.push(...pairUp(incomes, r.incomes, sameIncome).fresh);
  }
  return { expenses, excludedIncome: incomes.length, overlapped };
}

// 화면 순서(위→아래)로 늘어놓는다.
//  - 날짜 헤더가 있는 장: 첫 헤더가 최신인 장이 위쪽. 첫 헤더가 같으면 그 헤더보다 위에 거래가 보이는 장이 위쪽
//    (더 위로 스크롤한 화면), 그래도 같으면 고른 순서.
//  - 헤더가 없는 장(하루치가 한 화면을 넘는 경우): 스크롤 경계에 겹쳐 찍힌 거래로 자리를 찾는다.
//    첫 거래가 어느 장의 마지막 거래와 겹치면 그 장 바로 아래, 마지막 거래가 어느 장의 첫 거래와 겹치면 그 장 바로 위.
//    겹치는 장을 못 찾으면 바로 앞에 고른 장 뒤(그것도 없으면 맨 위).
function orderPages(pages) {
  const order = pages
    .filter((p) => p.first)
    .sort((a, b) => (a.first !== b.first ? (a.first < b.first ? 1 : -1) : Number(b.lead) - Number(a.lead)));
  const pending = pages.filter((p) => !p.first);
  // 헤더 없는 장이 연달아 있어도 사슬처럼 이어지도록, 더 끼울 장이 없을 때까지 반복
  for (let placed = true; placed; ) {
    placed = false;
    for (const h of [...pending]) {
      const above = onlyOne(order.filter((p) => overlaps(p.items.slice(-2), h.items.slice(0, 2))));
      const below = above ? null : onlyOne(order.filter((p) => overlaps(h.items.slice(-2), p.items.slice(0, 2))));
      if (!above && !below) continue;
      order.splice(above ? order.indexOf(above) + 1 : order.indexOf(below), 0, h);
      pending.splice(pending.indexOf(h), 1);
      placed = true;
    }
  }
  for (const h of pending) {
    const before = pages.slice(0, pages.indexOf(h)).reverse().find((p) => order.includes(p));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, h);
  }
  return order;
}

// 위 장의 끝 거래들(tail)과 아래 장의 첫 거래들(head)이 스크롤 경계에서 겹치는지.
// 끝 줄이 잘려 한쪽만 읽혔을 수 있어 양쪽 2건씩 비교하고, 헤더 없는 장은 날짜를 모르니 날짜는 빼고 비교한다.
function overlaps(tail, head) {
  return tail.some((t) => head.some((e) => sameTxnAnyDay(t, e)));
}

// 후보가 딱 하나일 때만 그 장 (여럿이면 어디인지 확신할 수 없음)
function onlyOne(found) {
  return found.length === 1 ? found[0] : null;
}

function sameDayTxn(a, b) {
  return a.date === b.date && sameTxnAnyDay(a, b);
}
function sameTxnAnyDay(a, b) {
  return sameTxn({ amount: a.amount, time: a.time, name: a.merchant }, { amount: b.amount, time: b.time, name: b.merchant });
}
function sameIncome(a, b) {
  return a.date === b.date && a.amount === b.amount;
}
