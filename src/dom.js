// dom.js — 화면 조작·표시에 공통으로 쓰는 작은 도우미들.
// (앱 상태는 들고 있지 않은 순수 유틸이라 어디서든 가져다 씁니다.)

/** id로 엘리먼트 찾기 */
export const $ = (id) => document.getElementById(id);

/** 금액을 "1,234원" 형태로 */
export const fmt = (n) => (Number(n) || 0).toLocaleString("ko-KR") + "원";

/** 좁은 칩용 짧은 금액: 1만 이상은 "1.2만", 그 미만은 천단위 콤마 */
export const fmtShort = (n) =>
  n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, "") + "만" : n.toLocaleString("ko-KR");

/** HTML 삽입 전 사용자 입력을 이스케이프 */
export const esc = (s) =>
  String(s ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** 상단 로딩 바 표시/숨김 */
export const showLoading = (on) => ($("loadingBar").style.display = on ? "block" : "none");
