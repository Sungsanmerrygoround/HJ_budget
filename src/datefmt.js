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
