// auth.js — 로그인 화면 없이 "가족 공용 계정"으로 자동 로그인합니다.
//
// 흐름:
//  - 앱이 켜지면 firebase-config.js의 familyAccount로 자동 로그인 시도
//  - 그 계정이 아직 없으면(처음 실행) 자동으로 만들어 줌
//  - 가족이 같은 계정을 쓰므로 어느 기기에서나 같은 가계부가 동기화됨

import { auth } from "./firebase.js";
import { familyAccount } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
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
  renderUserBar(user);
  listeners.forEach((fn) => fn(user));
});

/**
 * 가족 계정으로 자동 로그인. 계정이 없으면 만들어서 로그인.
 * @returns {Promise<import('firebase/auth').User|null>}
 */
export async function autoSignIn() {
  const { email, password } = familyAccount;
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  } catch (err) {
    // 계정이 아직 없는 경우 → 처음 한 번 만들어 줍니다.
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      console.log("👨‍👩‍👧 가족 계정을 새로 만들었어요.");
      return cred.user;
    } catch (err2) {
      if (err2.code === "auth/email-already-in-use") {
        // 계정은 있는데 비밀번호가 틀린 경우
        console.error("⚠️ 가족 계정 비밀번호가 맞지 않아요. firebase-config.js를 확인하세요.");
      } else {
        console.error("⚠️ 자동 로그인 실패:", err2.code || err2);
      }
      setBar("⚠️ 로그인 실패 — 설정을 확인하세요");
      return null;
    }
  }
}

// 상단 바에 동기화 상태를 표시 (로그인/로그아웃 버튼은 없음)
function renderUserBar(user) {
  if (user) setBar("☁️ 동기화됨 · 가족 계정");
  else setBar("");
}

function setBar(text) {
  const bar = document.querySelector("#user-bar");
  const label = document.querySelector("#user-email");
  if (!bar || !label) return;
  bar.hidden = !text;
  label.textContent = text;
}
