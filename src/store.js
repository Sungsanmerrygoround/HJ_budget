// store.js — 월별 가계부 데이터를 Firestore에 저장/조회합니다.
//
// 데이터 위치: users/{uid}/budgets/{년_월}
//   예: users/abc123/budgets/2026_5  (2026년 6월 — month는 0~11)
//   문서 내용: { entries: [{category, desc, amount, date}], budget: number }
//
// 기존 가계부와 같은 "월문서" 구조에, 우리 가족 계정(uid)을 한 겹 더 둔 형태입니다.

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

function monthRef(uid, year, month) {
  return doc(db, "users", uid, "budgets", monthDocId(year, month));
}

/** 특정 월 데이터를 불러옵니다. 없으면 빈 값. */
export async function loadMonth(uid, year, month) {
  const snap = await getDoc(monthRef(uid, year, month));
  if (snap.exists()) {
    const data = snap.data();
    return { entries: data.entries || [], budget: data.budget || 0 };
  }
  return { entries: [], budget: 0 };
}

/** 특정 월 데이터를 통째로 저장합니다. */
export async function saveMonth(uid, year, month, { entries, budget }) {
  await setDoc(monthRef(uid, year, month), {
    entries: entries || [],
    budget: budget || 0,
  });
}

// ── 학습형 자동분류: 가맹점 → 카테고리 기억 ──
// 위치: users/{uid}/meta/merchantMap  문서의 map 필드 { 가맹점키: 카테고리 }
function merchantMapRef(uid) {
  return doc(db, "users", uid, "meta", "merchantMap");
}

/** 학습된 가맹점→카테고리 매핑 전체를 불러옵니다. */
export async function loadMerchantMap(uid) {
  const snap = await getDoc(merchantMapRef(uid));
  return snap.exists() ? snap.data().map || {} : {};
}

/** 가맹점 하나의 카테고리를 학습(저장)합니다. (merge로 다른 키는 유지) */
export async function saveMerchantRule(uid, key, category) {
  await setDoc(merchantMapRef(uid), { map: { [key]: category } }, { merge: true });
}
