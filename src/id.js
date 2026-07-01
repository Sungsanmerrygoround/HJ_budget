// id.js — 추측 불가능한 고유 id를 만듭니다.
// 내역 항목(entryops)·가족 코드(household) 등 여러 곳에서 공용으로 씁니다.

/** 추측 불가능한 새 id를 만듭니다(UUID, 아주 옛 브라우저는 폴백). */
export function genId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
