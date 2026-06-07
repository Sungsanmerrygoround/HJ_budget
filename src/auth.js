// auth.js — 로그인 화면 없이 "익명 로그인"으로 자동 연결합니다.
//
// 왜 익명 로그인?
//  - 가족 누구나 URL만 열면 바로 사용 (로그인 화면 없음)
//  - 그래도 Firestore 규칙에서 "로그인된 요청만 허용"을 걸 수 있어,
//    아무 스크립트나 DB에 막 접근하는 건 막아줌
//  - 데이터는 가족 공용 경로(budgets/년_월)에 함께 저장돼 모두가 같은 가계부를 봄

import { auth } from "./firebase.js";
import {
  onAuthStateChanged,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

let currentUser = null;
const listeners = new Set();

export function getUser() {
  return currentUser;
}

export function onUserChange(fn) {
  listeners.add(fn);
  queueMicrotask(() => fn(currentUser));
  return () => listeners.delete(fn);
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  renderBar(user);
  listeners.forEach((fn) => fn(user));
});

/** 익명으로 자동 로그인합니다. */
export async function autoSignIn() {
  try {
    const cred = await signInAnonymously(auth);
    return cred.user;
  } catch (err) {
    console.error("⚠️ 자동 연결 실패:", err.code || err);
    setBar("⚠️ 연결 실패 — 새로고침 해보세요");
    return null;
  }
}

function renderBar(user) {
  setBar(user ? "☁️ 가족과 동기화 중" : "");
}

function setBar(text) {
  const bar = document.querySelector("#user-bar");
  const label = document.querySelector("#user-email");
  if (!bar || !label) return;
  bar.hidden = !text;
  label.textContent = text;
}
