// entryops.js — 내역 배열을 "키로 찾아" 교체/삭제하는 순수 함수들.
//
// 왜 인덱스가 아니라 키인가?
//   수정·삭제는 트랜잭션 안에서 "서버의 최신 배열"을 대상으로 처리합니다.
//   그 사이 다른 가족이 항목을 넣거나 지우면 인덱스가 밀리므로, 화면의 인덱스로
//   지우면 엉뚱한 걸 건드릴 수 있습니다. 그래서 고유 id로 항목을 특정합니다.
//
// 왜 id가 필요한가?
//   예전엔 (날짜|내용|금액)을 키로 썼는데, 같은 분에 같은 가맹점·금액을 두 번
//   등록하면(예: 커피 두 잔) 키가 완전히 같아져 두 문제가 생겼습니다:
//     1) appendEntries가 쓰는 Firestore arrayUnion은 값이 같은 항목을 "중복"으로
//        보고 조용히 버려, 두 번째 항목이 저장 자체가 안 됨.
//     2) 수정/삭제 시 어느 항목을 가리키는지 구별할 수 없어 엉뚱한 걸 건드릴 수 있음.
//   그래서 새 항목에는 생성 시 고유 id(id.js의 genId)를 붙입니다. id가 없는 옛
//   데이터는 (날짜|내용|금액)으로 폴백하고, 편집을 거치면 id가 채워집니다(자가 치유).

import { dateKey, timeOf, dayOf } from "./datefmt.js";
import { normMerchant } from "./categorize.js";

/** 내역을 식별하는 키: id가 있으면 id, 없으면 "날짜|내용|금액"(옛 데이터 폴백) */
export function entryKey(e) {
  return e.id || `${e.date}|${e.desc}|${e.amount}`;
}

/**
 * 날짜·시각 최신순 정렬용 비교 함수 (같은 달 안의 내역). 같으면 나중에 넣은 것이 위(_origIdx가 있으면 그것으로),
 * 날짜를 못 읽는 옛 데이터는 맨 아래.
 */
export function byDateDesc(a, b) {
  const da = dayOf(a.date), db = dayOf(b.date);
  const va = Number.isNaN(da) ? -1 : da * 1440 + minutesOf(timeOf(a.date, null));
  const vb = Number.isNaN(db) ? -1 : db * 1440 + minutesOf(timeOf(b.date, null));
  return vb - va || (b._origIdx ?? 0) - (a._origIdx ?? 0);
}

/** key와 일치하는 첫 항목을 newEntry로 교체한 새 배열을 돌려줍니다. */
export function replaceEntry(entries, key, newEntry) {
  const next = entries.slice();
  const i = next.findIndex((e) => entryKey(e) === key);
  if (i >= 0) next[i] = newEntry;
  return next;
}

/** key와 일치하는 첫 항목을 제거한 새 배열을 돌려줍니다. */
export function removeEntry(entries, key) {
  const next = entries.slice();
  const i = next.findIndex((e) => entryKey(e) === key);
  if (i >= 0) next.splice(i, 1);
  return next;
}

/**
 * 같은 날의 두 거래가 같은 거래인지. 캡쳐 여러 장을 합칠 때(겹쳐 찍힌 거래)와 저장 전 중복 거르기가 함께 쓰는 규칙:
 * 금액이 같고, 시각을 둘 다 알면 시각까지 같아야 하며, 한쪽이라도 모르면(없음·00:00) 가맹점명이 같아야 함.
 *  - 시각을 알면 이름은 보지 않음: 장마다 OCR이 이름을 조금씩 다르게 읽거나, 잘못 읽힌 이름을 고쳐 저장한 거래도 알아봄.
 *  - 00:00은 '시각 모름'으로 봄: 시각 없이 저장된 내역이 00:00으로 남고, 자정 결제(넷플릭스·웨이브)도 이름으로 구분.
 *  - 이름은 띄어쓰기·대소문자·기호를 무시하고 비교("GS25 역삼점" = "GS25역삼점").
 * @param {{amount: number, time: string|null, name: string}} a  time = "HH:MM"(또는 "H:MM") / 모르면 null
 * @param {{amount: number, time: string|null, name: string}} b
 */
export function sameTxn(a, b) {
  if (Number(a.amount) !== Number(b.amount)) return false;
  const ta = minutesOf(a.time);
  const tb = minutesOf(b.time);
  return ta && tb ? ta === tb : normMerchant(a.name) === normMerchant(b.name);
}

/**
 * incoming의 각 항목을 existing 중 same()인 것과 하나씩 짝짓습니다. 한 번 짝지은 항목은 다시 쓰지 않아,
 * 같은 거래가 연달아 있어도(커피 두 잔) 개수까지 맞습니다: existing 1잔 + incoming 2잔 → 1쌍 + 짝 없는 1잔.
 * @returns {{fresh: object[], pairs: Array<[object, object]>}} fresh = 짝이 없는 incoming 항목, pairs = [existing 항목, incoming 항목]
 */
export function pairUp(existing, incoming, same) {
  const pool = existing.slice();
  const fresh = [];
  const pairs = [];
  for (const e of incoming) {
    const i = pool.findIndex((x) => same(x, e));
    if (i >= 0) pairs.push([pool.splice(i, 1)[0], e]);
    else fresh.push(e);
  }
  return { fresh, pairs };
}

/**
 * 새로 넣을 내역(incoming) 중 이미 저장된(existing) 거래는 빼고 돌려줍니다. (같은 캡쳐를 다시 올린 경우 등)
 * 같은 날이고 sameTxn이면 같은 거래. id는 보지 않아, 저장 후 편집해 id가 생긴 거래도 알아봅니다.
 * @returns {{toAdd: object[], skipped: number}}
 */
export function newEntriesOnly(existing, incoming) {
  const { fresh, pairs } = pairUp(existing, incoming, sameEntry);
  return { toAdd: fresh, skipped: pairs.length };
}

function sameEntry(a, b) {
  return dayKey(a.date) === dayKey(b.date) &&
    sameTxn({ amount: a.amount, time: timeOf(a.date, null), name: a.desc }, { amount: b.amount, time: timeOf(b.date, null), name: b.desc });
}

// "6/7 16:38" → "6/7" (앞자리 0 차이 "06/07"도 같은 날로)
function dayKey(date) {
  return dateKey(date).split("/").map(Number).join("/");
}

// "9:05"·"09:05" → 545(분). 시각을 모르면(00:00·없음) 0
function minutesOf(time) {
  const [h, m] = String(time ?? "").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
