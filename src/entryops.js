// entryops.js — 내역 배열을 "키로 찾아" 교체/삭제하는 순수 함수들.
//
// 왜 인덱스가 아니라 키인가?
//   수정·삭제는 트랜잭션 안에서 "서버의 최신 배열"을 대상으로 처리합니다.
//   그 사이 다른 가족이 항목을 넣거나 지우면 인덱스가 밀리므로, 화면의 인덱스로
//   지우면 엉뚱한 걸 건드릴 수 있습니다. 그래서 (날짜|내용|금액)으로 항목을 특정합니다.
//   같은 키가 여럿이면 "첫 번째"를 대상으로 삼습니다(값이 같아 결과는 동등).

/** 내역을 식별하는 키: "날짜|내용|금액" */
export function entryKey(e) {
  return `${e.date}|${e.desc}|${e.amount}`;
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
