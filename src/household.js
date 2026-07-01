// household.js — "가족 코드(hid)"를 관리합니다.
//
// 왜 필요? 예전엔 모든 데이터가 최상위 budgets/ 에 있어, 사이트 URL만 알면
// (익명 자동 로그인 탓에) 누구나 읽고 쓸 수 있었습니다. 이제 데이터를
// households/{hid}/... 로 나눠 담고, hid(추측 불가능한 랜덤 코드)를 아는
// 가족만 같은 가계부를 공유합니다.
//
// hid 결정 순서:
//   1) URL 쿼리 ?h=코드   → 가족이 공유한 링크로 처음 들어온 경우(코드를 채택)
//   2) localStorage 저장값 → 이 기기에서 이미 쓰던 코드
//   3) 없으면 새로 생성     → 첫 사용자(이 코드를 가족과 공유하면 됨)

const KEY = "hj_household";

/** 추측 불가능한 새 가족 코드를 만듭니다. */
function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // 아주 옛 브라우저 대비 폴백
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** 이 기기에서 사용할 가족 코드를 돌려줍니다(없으면 생성해 저장). */
export function getHouseholdId() {
  try {
    const fromUrl = new URLSearchParams(location.search).get("h");
    if (fromUrl) {
      localStorage.setItem(KEY, fromUrl); // 공유 링크로 들어옴 → 그 코드를 채택
      return fromUrl;
    }
    const saved = localStorage.getItem(KEY);
    if (saved) return saved;
    const fresh = generateId();
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // localStorage가 막힌 사생활 모드 등: 세션 한정 코드라도 발급
    return generateId();
  }
}

/** 가족에게 공유할, 코드가 담긴 링크를 만듭니다. */
export function shareLink(hid = getHouseholdId()) {
  const u = new URL(location.href);
  u.searchParams.set("h", hid);
  return u.toString();
}
