// 검증 스크립트: node test-datefmt.mjs
import { dayOf, timeOf, dateKey, makeEntryDate, clampDay } from "./src/datefmt.js";

let pass = 0, fail = 0;
function check(name, got, expected) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`✅ ${name}`); }
  else {
    fail++;
    console.log(`❌ ${name}\n   기대: ${JSON.stringify(expected)}\n   실제: ${JSON.stringify(got)}`);
  }
}

// dayOf: "M/D HH:MM"에서 '일'만
check("dayOf 기본", dayOf("6/7 16:38"), 7);
check("dayOf 두 자리 일", dayOf("12/25 09:00"), 25);
check("dayOf 시간 없음", dayOf("3/9"), 9);
check("dayOf 빈 값 → NaN", Number.isNaN(dayOf("")), true);
check("dayOf null → NaN", Number.isNaN(dayOf(null)), true);

// timeOf: "HH:MM"만, 없으면 fallback
check("timeOf 기본", timeOf("6/7 16:38"), "16:38");
check("timeOf 시간 없음 → 기본값", timeOf("6/7"), "00:00");
check("timeOf 커스텀 fallback", timeOf("6/7", "12:00"), "12:00");

// dateKey: "M/D"만
check("dateKey 기본", dateKey("6/7 16:38"), "6/7");
check("dateKey 시간 없음", dateKey("6/7"), "6/7");

// makeEntryDate: 월(0~11)·일·시각 → "M/D HH:MM"
check("makeEntryDate 6월", makeEntryDate(5, 7, "16:38"), "6/7 16:38");
check("makeEntryDate 기본 시각", makeEntryDate(0, 1), "1/1 00:00");

// clampDay: 1~lastDay 범위로
check("clampDay 정상", clampDay(15, 30), 15);
check("clampDay 하한", clampDay(0, 30), 1);
check("clampDay 상한", clampDay(31, 30), 30);

// 왕복: dayOf(makeEntryDate(...)) 일관성
check("왕복 일관성", dayOf(makeEntryDate(5, 7, timeOf("6/7 16:38"))), 7);

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
