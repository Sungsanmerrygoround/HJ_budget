// store.js — 가족 공용 가계부 데이터를 Firestore에 저장/조회합니다.
//
// 데이터 위치(가족별로 분리):
//   households/{hid}/budgets/{년_월}   예: .../budgets/2026_5 → { entries: [...], budget }
//   households/{hid}/meta/merchantMap  학습형 분류 { 가맹점키: 카테고리 }
//
// hid(가족 코드)는 household.js가 관리하며, 코드를 아는 가족만 같은 문서를 공유합니다.
//
// ★ 동시 편집 안전:
//   예전엔 setDoc으로 문서 전체를 덮어써, 두 사람이 동시에 추가하면 한쪽이 유실될 수
//   있었습니다. 이제 용도별 원자적 연산을 씁니다:
//     - 추가       → arrayUnion (읽지 않고 append, budget 안 건드림)
//     - 예산 설정  → merge (entries 안 건드림)
//     - 수정/삭제  → 트랜잭션 (최신 배열을 읽어 키로 바꾼 뒤 저장)

import { db } from "./firebase.js";
import {
  doc,
  getDoc,
  setDoc,
  arrayUnion,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getHouseholdId } from "./household.js";

// hid는 세션 동안 고정 — 처음 쓸 때 한 번 결정합니다.
let _hid = null;
function hid() {
  return (_hid ??= getHouseholdId());
}

// 월 문서 id: "년_월(0~11)"
export function monthDocId(year, month) {
  return `${year}_${month}`;
}

function monthRef(year, month) {
  return doc(db, "households", hid(), "budgets", monthDocId(year, month));
}

/** 특정 월 데이터를 불러옵니다. 없으면 빈 값. */
export async function loadMonth(year, month) {
  const snap = await getDoc(monthRef(year, month));
  if (snap.exists()) {
    const data = snap.data();
    return { entries: data.entries || [], budget: data.budget || 0 };
  }
  return { entries: [], budget: 0 };
}

/** 내역을 원자적으로 추가합니다(문서가 없으면 생성). budget은 건드리지 않습니다. */
export async function appendEntries(year, month, entries) {
  if (!entries || entries.length === 0) return;
  await setDoc(monthRef(year, month), { entries: arrayUnion(...entries) }, { merge: true });
}

/** 예산만 원자적으로 설정합니다. entries는 건드리지 않습니다. */
export async function setBudget(year, month, budget) {
  await setDoc(monthRef(year, month), { budget: budget || 0 }, { merge: true });
}

/**
 * 내역 배열을 트랜잭션 안에서 안전하게 변형합니다(수정·삭제용).
 * @param {(entries: Array) => Array} mutate 최신 배열 → 새 배열
 */
export async function mutateEntries(year, month, mutate) {
  const ref = monthRef(year, month);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? (snap.data().entries || []) : [];
    const next = mutate(current);
    tx.set(ref, { entries: next }, { merge: true });
  });
}

/** 월 데이터를 통째로 저장합니다(마이그레이션·복원 등 전체 쓰기 전용). */
export async function saveMonth(year, month, { entries, budget }) {
  await setDoc(monthRef(year, month), {
    entries: entries || [],
    budget: budget || 0,
  });
}

// ── 학습형 자동분류: 가맹점 → 카테고리 기억 ──
function merchantMapRef() {
  return doc(db, "households", hid(), "meta", "merchantMap");
}

/** 학습된 가맹점→카테고리 매핑 전체를 불러옵니다. */
export async function loadMerchantMap() {
  const snap = await getDoc(merchantMapRef());
  return snap.exists() ? snap.data().map || {} : {};
}

/** 가맹점 하나의 카테고리를 학습(저장)합니다. */
export async function saveMerchantRule(key, category) {
  await setDoc(merchantMapRef(), { map: { [key]: category } }, { merge: true });
}
