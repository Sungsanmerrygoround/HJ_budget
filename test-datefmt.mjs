// 검증 스크립트: node test-datefmt.mjs
import { check, done } from "./test-util.mjs";
import { dayOf, timeOf, dateKey, makeEntryDate, clampDay, toISO, todayISO, daysInMonth, parseISO, shortDate } from "./src/datefmt.js";

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

// ISO("YYYY-MM-DD") 도우미 — 월은 1~12
check("toISO 자릿수 채움", toISO(2026, 6, 7), "2026-06-07");
check("todayISO 주어진 시각", todayISO(new Date(2026, 9, 17, 23, 59)), "2026-10-17");
check("daysInMonth 2월(윤년/평년)", [daysInMonth(2028, 2), daysInMonth(2026, 2)], [29, 28]);
check("daysInMonth 12월", daysInMonth(2026, 12), 31);
check("parseISO 정상", parseISO("2026-06-07"), { year: 2026, month: 6, day: 7 });
check("parseISO 없는 날짜(2월 30일) → null", parseISO("2026-02-30"), null);
check("parseISO 형식 아님 → null", [parseISO(""), parseISO(null), parseISO("2026-6-7"), parseISO("2026-13-01")], [null, null, null, null]);
check("shortDate", [shortDate("2026-06-12"), shortDate("2026-12-01"), shortDate("깨진값")], ["6/12", "12/1", ""]);

done();
