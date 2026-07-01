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
