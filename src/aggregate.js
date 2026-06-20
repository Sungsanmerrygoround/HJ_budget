// aggregate.js — 내역 배열에서 합계·카테고리별 통계를 한곳에서 계산합니다.
//
// 예전엔 render·차트·칩·목록이 저마다 `entries.filter(...).reduce(...)`를
// 반복했는데(카테고리 × 내역 수만큼 매번 순회), 같은 계산을 여기로 모아
// 한 번의 순회로 끝냅니다. (순수 함수라 테스트도 쉬움)

import { CATS } from "./categorize.js";

/** 전체 지출 합계 */
export function sumAmount(entries) {
  return entries.reduce((s, e) => s + e.amount, 0);
}

/** 카테고리별 합계를 CATS와 같은 순서의 배열로 (한 번의 순회). */
export function categoryTotals(entries) {
  const totals = CATS.map(() => 0);
  const indexOf = new Map(CATS.map((c, i) => [c, i]));
  for (const e of entries) {
    const i = indexOf.get(e.category);
    if (i !== undefined) totals[i] += e.amount; // CATS에 없는 카테고리는 무시(기존과 동일)
  }
  return totals;
}

/** 지출이 있는 카테고리를 큰 순으로 정렬해 {cat, i, total} 배열로. */
export function rankedCategories(entries) {
  const totals = categoryTotals(entries);
  return CATS.map((cat, i) => ({ cat, i, total: totals[i] }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
}
