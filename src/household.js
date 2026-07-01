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

import { genId } from "./id.js";

export const KEY = "hj_household";

// 가족 코드로 허용하는 형식: 영숫자·하이픈·밑줄(1~128자).
// UUID(crypto.randomUUID)와 base36 폴백 코드가 모두 이 범위 안에 든다.
// hid는 Firestore 경로 세그먼트 doc(db,"households",hid,...)로 쓰이므로,
// "/"·공백·제어문자가 섞이면 세그먼트 수가 어긋나 doc()이 예외를 던지고 앱이 깨진다.
// (예: 악의적 초대 링크 ?h=a/b/c 로 수신자 앱을 망가뜨리는 것을 막는다.)
export function isValidHid(s) {
  return typeof s === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(s);
}

/** 이 기기에서 사용할 가족 코드를 돌려줍니다(없으면 생성해 저장). */
export function getHouseholdId() {
  try {
    const fromUrl = new URLSearchParams(location.search).get("h");
    if (fromUrl && isValidHid(fromUrl)) {
      localStorage.setItem(KEY, fromUrl); // 공유 링크로 들어옴 → 그 코드를 채택
      // ?h= 는 "채택"용 1회성 신호일 뿐, 계속 남아있으면 다음에 수동으로 다른
      // 코드로 전환해도(setHouseholdId) 새로고침할 때마다 다시 이 코드로 되돌아감.
      // 채택 즉시 주소창에서 지워 재로드 시 localStorage 값이 우선하게 함.
      const u = new URL(location.href);
      u.searchParams.delete("h");
      history.replaceState(null, "", u.toString());
      return fromUrl;
    }
    const saved = localStorage.getItem(KEY);
    if (saved && isValidHid(saved)) return saved; // 손상된 값이면 무시하고 새로 발급(자가 치유)
    const fresh = genId();
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // localStorage가 막힌 사생활 모드 등: 세션 한정 코드라도 발급
    return genId();
  }
}

/** 가족에게 공유할, 코드가 담긴 링크를 만듭니다. */
export function shareLink(hid = getHouseholdId()) {
  const u = new URL(location.href);
  u.searchParams.set("h", hid);
  return u.toString();
}

// 이 기기가 사용할 가족 코드를 직접 지정합니다(다른 가족 코드로 전환할 때 사용).
//
// 왜 필요? iOS 16.4+는 "홈 화면에 추가"한 아이콘을 열 때 manifest.webmanifest의
// start_url("./")을 그대로 써서, 주소창에 ?h=코드가 있어도 실행 시 사라집니다.
// 홈 화면 앱에서는 URL로 코드를 못 넘기니, 코드를 직접 입력해 전환하는 경로가 필요합니다.
export function setHouseholdId(hid) {
  if (!isValidHid(hid)) return false; // 경로를 깨뜨릴 잘못된 코드는 거부
  try {
    localStorage.setItem(KEY, hid);
    return true;
  } catch {
    // 저장 실패해도(사생활 모드 등) 이번 세션에서는 넘어갈 수 있게 무시
    return false;
  }
}
