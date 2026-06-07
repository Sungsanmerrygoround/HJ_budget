// store.js — 가족 공용 가계부 데이터를 Firestore에 저장/조회합니다.
//
// 데이터 위치(가족 공용):
//   budgets/{년_월}          예: budgets/2026_5  → { entries: [...], budget: number }
//   meta/merchantMap         학습형 분류 { 가맹점키: 카테고리 }
//
// 로그인(익명)된 가족 구성원은 모두 같은 문서를 보고 함께 편집합니다.

import { db } from "./firebase.js";
import {
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// 월 문서 id: "년_월(0~11)"
export function monthDocId(year, month) {
  return `${year}_${month}`;
}

function monthRef(year, month) {
  return doc(db, "budgets", monthDocId(year, month));
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

/** 특정 월 데이터를 통째로 저장합니다. */
export async function saveMonth(year, month, { entries, budget }) {
  await setDoc(monthRef(year, month), {
    entries: entries || [],
    budget: budget || 0,
  });
}

// ── 학습형 자동분류: 가맹점 → 카테고리 기억 ──
function merchantMapRef() {
  return doc(db, "meta", "merchantMap");
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
