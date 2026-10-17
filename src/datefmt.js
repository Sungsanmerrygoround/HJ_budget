// datefmt.js — 내역 날짜 문자열("M/D HH:MM") 처리를 한곳에서 다룹니다.
//
// 내역의 date 필드는 "6/7 16:38"처럼 "월/일 시:분" 형식입니다.
// 예전엔 이 문자열을 여기저기서 `.split(" ")[0].split("/")[1]`로 쪼갰는데,
// 파싱을 한곳에 모아 실수(월/일 뒤바뀜 등)를 줄입니다. (순수 함수라 테스트 쉬움)

/** "M/D HH:MM"에서 '일'(숫자)만 뽑습니다. 못 읽으면 NaN. */
export function dayOf(dateStr) {
  return parseInt((String(dateStr ?? "").split(" ")[0] || "").split("/")[1]);
}

/** "M/D HH:MM"에서 "HH:MM"만 뽑습니다. 시간이 없으면 fallback. */
export function timeOf(dateStr, fallback = "00:00") {
  const s = String(dateStr ?? "");
  return s.includes(" ") ? s.split(" ")[1] : fallback;
}

/** "M/D" 부분(달력 그룹 키)만 뽑습니다. */
export function dateKey(dateStr) {
  return String(dateStr ?? "").split(" ")[0];
}

/** 월(0~11)·일·시각으로 "M/D HH:MM" 문자열을 만듭니다. */
export function makeEntryDate(month0, day, time = "00:00") {
  return `${month0 + 1}/${day} ${time}`;
}

/** 일(day)을 1~lastDay 범위로 자릅니다. */
export function clampDay(day, lastDay) {
  return Math.min(Math.max(day, 1), lastDay);
}

// ── "YYYY-MM-DD"(ISO) 날짜: 날짜 입력칸·캡쳐 인식 결과에 쓰는 형식. 여기서는 월을 1~12로 셉니다. ──

/** 연·월(1~12)·일 → "YYYY-MM-DD" */
export function toISO(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 그 시각(기본: 지금)의 날짜 → "YYYY-MM-DD" */
export function todayISO(now = new Date()) {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** 그 달(1~12)의 일수 */
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** "YYYY-MM-DD" → {year, month(1~12), day}. 형식이 아니거나 달력에 없는 날짜(2월 30일 등)면 null */
export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ""));
  if (!m) return null;
  const [year, month, day] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** "2026-06-12" → "6/12" */
export function shortDate(iso) {
  const p = parseISO(iso);
  return p ? `${p.month}/${p.day}` : "";
}
