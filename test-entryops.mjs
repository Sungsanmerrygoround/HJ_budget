// 검증 스크립트: node test-entryops.mjs
import { check, done } from "./test-util.mjs";
import { entryKey, replaceEntry, removeEntry, newEntriesOnly, sameTxn, pairUp, byDateDesc } from "./src/entryops.js";
import { genId } from "./src/id.js";

const A = { date: "6/7 16:38", desc: "스타벅스", amount: 5500, category: "외식비" };
const B = { date: "6/7 17:02", desc: "GS25", amount: 2300, category: "생필품" };
const C = { date: "6/8 09:00", desc: "버스", amount: 1500, category: "교통비" };

check("entryKey 형식", entryKey(A), "6/7 16:38|스타벅스|5500");

// replaceEntry: 키로 찾아 교체
check("replaceEntry 교체",
  replaceEntry([A, B, C], entryKey(B), { ...B, amount: 9999 }).map((e) => e.amount),
  [5500, 9999, 1500]);

check("replaceEntry 불일치 시 원본 유지",
  replaceEntry([A, B], "없는|키|0", { ...A, amount: 1 }).map((e) => e.amount),
  [5500, 2300]);

// 원본 불변(순수 함수)
const src = [A, B];
replaceEntry(src, entryKey(A), { ...A, amount: 1 });
check("replaceEntry 원본 불변", src.map((e) => e.amount), [5500, 2300]);

// removeEntry: 키로 찾아 삭제
check("removeEntry 삭제",
  removeEntry([A, B, C], entryKey(B)).map((e) => e.desc),
  ["스타벅스", "버스"]);

check("removeEntry 불일치 시 원본 유지",
  removeEntry([A, B], "없는|키|0").length, 2);

// 중복 키: 첫 번째만 제거
const dup = [A, { ...A }, B];
check("removeEntry 중복 키 첫 번째만",
  removeEntry(dup, entryKey(A)).length, 2);

check("removeEntry 원본 불변", (() => { const s = [A, B]; removeEntry(s, entryKey(A)); return s.length; })(), 2);

// id가 있으면 필드값이 같아도 서로 다른 키를 가짐 (arrayUnion 중복 오인 방지)
const D1 = { ...A, id: genId() };
const D2 = { ...A, id: genId() }; // A와 같은 date/desc/amount지만 id가 다름
check("entryKey id 우선", entryKey(D1) !== entryKey(D2), true);
check("entryKey id 형식", entryKey(D1), D1.id);

check("replaceEntry id로 정확히 특정 (같은 필드값의 다른 항목과 구분)",
  replaceEntry([D1, D2], entryKey(D2), { ...D2, amount: 1 }).map((e) => e.amount),
  [5500, 1]);

// ── newEntriesOnly: 캡쳐 저장 직전, 이미 저장된 거래 빼기 ──
const cap = (date, desc, amount) => ({ date, desc, amount, category: "기타", id: genId() });
const descs = (r) => r.toAdd.map((e) => e.desc);

check("같은 캡쳐 다시 올림 → 전부 건너뜀",
  newEntriesOnly([A, B], [cap(A.date, A.desc, A.amount), cap(B.date, B.desc, B.amount)]).skipped, 2);

check("저장 후 편집해 id가 생긴 거래도 알아봄",
  newEntriesOnly([{ ...A, id: genId() }], [cap(A.date, A.desc, A.amount)]).skipped, 1);

check("잘못 읽힌 이름을 고쳐 저장했어도, 시간·금액이 같으면 같은 거래",
  newEntriesOnly([{ ...B, desc: "GS25 역삼점" }], [cap(B.date, "6525 역삼점", B.amount)]).skipped, 1);

check("시간 표기 차이(9:05 vs 09:05)는 같은 시각",
  newEntriesOnly([{ ...A, date: "6/7 9:05" }], [cap("6/7 09:05", "스타벅스", 5500)]).skipped, 1);

check("커피 두 잔: 저장된 1잔 + 새로 2잔 → 1잔만 추가",
  descs(newEntriesOnly([A], [cap(A.date, "스타벅스", 5500), cap(A.date, "스타벅스", 5500)])), ["스타벅스"]);

check("저장된 게 없으면 두 잔 다 추가",
  newEntriesOnly([], [cap(A.date, "스타벅스", 5500), cap(A.date, "스타벅스", 5500)]).toAdd.length, 2);

check("시간이 다르면 다른 거래",
  newEntriesOnly([A], [cap("6/7 10:00", "스타벅스", 5500)]).toAdd.length, 1);

check("날짜가 다르면 다른 거래",
  newEntriesOnly([A], [cap("6/8 16:38", "스타벅스", 5500)]).toAdd.length, 1);

check("금액이 다르면 다른 거래",
  newEntriesOnly([A], [cap(A.date, "스타벅스", 6000)]).toAdd.length, 1);

check("시간을 모르면(00:00) 내용까지 같아야 같은 거래 — 같음",
  newEntriesOnly([{ ...A, date: "6/7 00:00" }], [cap("6/7 00:00", "스타벅스", 5500)]).skipped, 1);

check("시간을 모르면(00:00) 내용까지 같아야 같은 거래 — 다름",
  newEntriesOnly([{ ...A, date: "6/7 00:00" }], [cap("6/7 00:00", "이디야", 5500)]).toAdd.length, 1);

check("한쪽만 시간을 알면 내용으로 비교",
  newEntriesOnly([A], [cap("6/7 00:00", "스타벅스", 5500)]).skipped, 1);

check("newEntriesOnly 원본 불변", (() => { const s = [A]; newEntriesOnly(s, [cap(A.date, "스타벅스", 5500)]); return s.length; })(), 1);

check("시간을 모르면 이름을 띄어쓰기·대소문자 무시하고 비교",
  newEntriesOnly([{ ...B, date: "6/7 00:00", desc: "GS25 역삼점" }], [cap("6/7 00:00", "gs25역삼점", 2300)]).skipped, 1);

check("시간 없는 날짜(\"6/7\")도 시간 모름으로",
  newEntriesOnly([{ ...A, date: "6/7" }], [cap("6/7 16:38", "스타벅스", 5500)]).skipped, 1);

// ── sameTxn: 캡쳐 합치기와 저장 중복 거르기가 함께 쓰는 '같은 거래' 규칙 ──
const t = (amount, time, name) => ({ amount, time, name });
check("sameTxn 시각을 알면 이름은 안 봄", sameTxn(t(5500, "16:38", "스타벅스"), t(5500, "16:38", "스E벅스")), true);
check("sameTxn 시각 표기 차이(9:05 = 09:05)", sameTxn(t(5500, "9:05", "A"), t(5500, "09:05", "B")), true);
check("sameTxn 시각이 다르면 다른 거래", sameTxn(t(5500, "16:38", "스타벅스"), t(5500, "10:00", "스타벅스")), false);
check("sameTxn 금액이 다르면 다른 거래", sameTxn(t(5500, "16:38", "A"), t(6000, "16:38", "A")), false);
check("sameTxn 00:00은 시각 모름 → 이름으로 (자정 결제 넷플릭스≠웨이브)",
  sameTxn(t(13500, "00:00", "넷플릭스"), t(13500, "00:00", "웨이브")), false);
check("sameTxn 시각 모름 + 이름 정규화(GS25 역삼점 = GS25역삼점)",
  sameTxn(t(2300, null, "GS25 역삼점"), t(2300, null, "GS25역삼점")), true);

// ── pairUp: 하나씩 짝짓기 ──
{
  const r = pairUp([1, 2, 2], [2, 2, 2, 3], (a, b) => a === b);
  check("pairUp 짝 개수까지 맞춤", [r.pairs, r.fresh], [[[2, 2], [2, 2]], [2, 3]]);
}

// ── byDateDesc: 내역 목록을 날짜·시각 최신순으로 ──
{
  const list = [
    { desc: "a", date: "10/15 19:00", _origIdx: 0 },
    { desc: "b", date: "10/3 12:00", _origIdx: 1 },
    { desc: "c", date: "10/17 8:30", _origIdx: 2 },
    { desc: "d", date: "10/15 12:10", _origIdx: 3 },
    { desc: "e", date: "", _origIdx: 4 },
    { desc: "f", date: "10/15 12:10", _origIdx: 5 },
  ];
  check("byDateDesc 날짜·시각 최신순, 같으면 나중에 넣은 것이 위, 날짜 없는 건 맨 아래",
    list.slice().sort(byDateDesc).map((e) => e.desc).join(""), "cafdbe");
}

done();
