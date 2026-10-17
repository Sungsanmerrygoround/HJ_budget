// capmerge.js — 캡쳐 여러 장의 인식 결과를 하나의 지출 목록으로 합칩니다. (순수 함수라 node로 테스트 가능)
//
// 긴 거래내역은 스크롤하며 여러 장으로 찍기 때문에, 장마다 따로 읽으면 두 가지가 틀어집니다:
//   1) 날짜: 둘째 장부터는 맨 위 날짜 헤더가 앞 장으로 잘려 나가, 윗부분 거래가 '오늘'로 잡힘
//      → 화면 순서대로 읽으며 앞 장의 마지막 날짜를 이어받는다.
//   2) 중복: 스크롤 경계의 거래가 앞 장 아래와 다음 장 위에 두 번 찍혀 지출이 두 배로 잡힘
//      → 다른 장에 이미 있는 같은 거래(날짜·금액·시간)는 한 번만 남긴다. (제외한 수입 개수도 같은 방식)
//
// 화면 순서는 고른 순서가 아니라 내용으로 정합니다(갤러리·파일 창마다 넘겨주는 순서가 제각각이라).
// 거래내역은 최신순이므로, 첫 날짜 헤더가 더 최신인 장이 더 위쪽 화면입니다.

import { parseTransactions } from "./parse.js";

/**
 * @param {(string|null)[]} texts 장별 OCR 원문 (고른 순서, 인식하지 못한 장은 null)
 * @param {{now?: Date}} [opts] now: '오늘'로 쓸 시각(테스트용)
 * @returns {{
 *   expenses: Array<{merchant: string, amount: number, date: string, time: string|null, src: number, idx: number}>,
 *   excludedIncome: number,
 *   overlapped: number,
 * }} expenses는 화면 순서(위→아래). src = 그 지출이 나온 장의 texts 인덱스, idx = 그 장 안에서 몇 번째 지출인지
 *    (같은 원문이면 늘 같은 값이라, 사진을 더 고른 뒤 다시 합쳐도 같은 항목을 알아볼 수 있음).
 *    excludedIncome = 제외한 수입 개수(겹친 건 한 번만), overlapped = 겹쳐서 뺀 지출 개수
 */
export function mergeCaptures(texts, opts = {}) {
  // 1) 장마다 한 번 읽어 첫 날짜 헤더와 거래를 얻는다 (화면 순서를 정하는 데만 사용)
  const pages = [];
  texts.forEach((text, src) => {
    if (text == null) return;
    const r = parseTransactions(text, { now: opts.now });
    pages.push({ src, text, first: r.firstDate, items: r.expenses });
  });

  // 2) 화면 순서대로 다시 읽으며 날짜를 이어받고, 앞 장들에 이미 있는 지출·수입은 한 번만 센다
  const expenses = [];
  const incomes = [];
  let overlapped = 0;
  let startDate; // 첫 장은 parse 기본값(오늘)
  for (const page of orderPages(pages)) {
    const r = parseTransactions(page.text, { now: opts.now, startDate });
    startDate = r.lastDate;
    overlapped += absorb(expenses, r.expenses.map((e, idx) => ({ ...e, src: page.src, idx })), sameTxn);
    absorb(incomes, r.incomes.map((e) => ({ ...e, src: page.src })), sameIncome);
  }
  return { expenses, excludedIncome: incomes.length, overlapped };
}

// 화면 순서(위→아래)로 늘어놓는다.
//  - 날짜 헤더가 있는 장: 첫 헤더가 최신인 장이 위쪽 (같은 날짜면 고른 순서)
//  - 헤더가 없는 장(하루치가 한 화면을 넘는 경우): 첫 거래가 어느 장의 마지막 거래와 겹치면(스크롤 경계)
//    그 장 바로 뒤. 겹치는 장을 못 찾으면 바로 앞에 고른 장 뒤(그것도 없으면 맨 위).
function orderPages(pages) {
  const order = pages.filter((p) => p.first).sort((a, b) => (a.first < b.first ? 1 : a.first > b.first ? -1 : 0));
  const pending = pages.filter((p) => !p.first);
  // 헤더 없는 장이 연달아 있어도 사슬처럼 이어지도록, 더 끼울 장이 없을 때까지 반복
  for (let placed = true; placed; ) {
    placed = false;
    for (const h of [...pending]) {
      const prev = overlapPrev(h, order);
      if (!prev) continue;
      order.splice(order.indexOf(prev) + 1, 0, h);
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

// h의 첫 거래(들)와 같은 거래로 끝나는 장이 딱 하나면 그 장.
// 끝 줄이 잘려 한쪽만 읽혔을 수 있어 양쪽 2건씩 비교하고, 헤더 없는 장은 날짜를 모르니 날짜는 빼고 비교한다.
function overlapPrev(h, order) {
  const head = h.items.slice(0, 2);
  const found = order.filter((p) => p.items.slice(-2).some((t) => head.some((e) => sameTxnAnyDay(t, e))));
  return found.length === 1 ? found[0] : null;
}

// items 중 앞 장들의 항목(list)과 겹치는 것은 빼고 나머지를 list에 덧붙인 뒤, 뺀 개수를 돌려준다.
// 이 장에서 이미 짝지은 항목은 다시 짝짓지 않아, 같은 거래가 연달아 있어도(커피 두 잔) 진짜 두 건은 둘 다 남는다.
function absorb(list, items, same) {
  const matched = new Set();
  let dup = 0;
  for (const it of items) {
    const twin = list.find((k) => k.src !== it.src && !matched.has(k) && same(k, it));
    if (twin) {
      matched.add(twin);
      dup++;
    } else {
      list.push(it);
    }
  }
  return dup;
}

// 두 장에 겹쳐 찍힌 같은 거래인지: 날짜·금액이 같고, 시간이 둘 다 있으면 시간까지 같아야 한다.
// (가맹점명은 같은 줄이라도 장마다 OCR이 조금씩 다르게 읽곤 해서, 시간을 알 땐 비교하지 않음)
function sameTxn(a, b) {
  return a.date === b.date && sameTxnAnyDay(a, b);
}
function sameTxnAnyDay(a, b) {
  if (a.amount !== b.amount) return false;
  return a.time && b.time ? a.time === b.time : a.merchant === b.merchant;
}
function sameIncome(a, b) {
  return a.date === b.date && a.amount === b.amount;
}
