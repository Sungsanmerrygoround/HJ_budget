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

import { dateKey, timeOf } from "./datefmt.js";

/** 내역을 식별하는 키: id가 있으면 id, 없으면 "날짜|내용|금액"(옛 데이터 폴백) */
export function entryKey(e) {
  return e.id || `${e.date}|${e.desc}|${e.amount}`;
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
 * 새로 넣을 내역(incoming) 중 이미 저장된(existing) 거래는 빼고 돌려줍니다. (같은 캡쳐를 다시 올린 경우 등)
 * 같은 거래 판단: 같은 날·같은 금액이고, 시간을 둘 다 알면 시간까지 같고, 한쪽이라도 모르면(00:00) 내용까지 같음.
 *  - 시간을 알면 id·내용은 보지 않음: 저장 후 편집해 id가 생겼거나, 잘못 읽힌 가맹점명을 고쳐 저장한
 *    거래도 같은 거래로 알아본다.
 *  - 개수까지 맞춤(하나씩 짝지음): 저장된 커피 1잔 + 새로 2잔 → 1잔만 추가.
 * @returns {{toAdd: object[], skipped: number}}
 */
export function newEntriesOnly(existing, incoming) {
  const pool = existing.slice();
  const toAdd = [];
  let skipped = 0;
  for (const e of incoming) {
    const i = pool.findIndex((x) => sameEntry(x, e));
    if (i >= 0) {
      pool.splice(i, 1);
      skipped++;
    } else {
      toAdd.push(e);
    }
  }
  return { toAdd, skipped };
}

function sameEntry(a, b) {
  if (Number(a.amount) !== Number(b.amount) || dayKey(a.date) !== dayKey(b.date)) return false;
  const ta = minutesOf(a.date);
  const tb = minutesOf(b.date);
  return ta && tb ? ta === tb : String(a.desc ?? "").trim() === String(b.desc ?? "").trim();
}

// "6/7 16:38" → "6/7" (앞자리 0 차이 "06/07"도 같은 날로)
function dayKey(date) {
  return dateKey(date).split("/").map(Number).join("/");
}

// "6/7 9:05"·"6/7 09:05" → 545(분). 시간을 모르면(00:00·없음) 0
function minutesOf(date) {
  const [h, m] = timeOf(date).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
