// 검증 스크립트: node test-entryops.mjs
import { entryKey, replaceEntry, removeEntry } from "./src/entryops.js";
import { genId } from "./src/id.js";

let pass = 0, fail = 0;
function check(name, got, expected) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`✅ ${name}`); }
  else {
    fail++;
    console.log(`❌ ${name}\n   기대: ${JSON.stringify(expected)}\n   실제: ${JSON.stringify(got)}`);
  }
}

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

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
