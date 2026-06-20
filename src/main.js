// main.js — snap-budget 앱 컨트롤러
// 상태·데이터·라우팅을 담당하고, 렌더링은 renderer.js, OCR 흐름은 capture.js에 위임합니다.

import { categorize, CATS, CAT_ICONS } from "./categorize.js";
import { isConfigured } from "./firebase-config.js";
import { $, fmt, esc, showLoading } from "./dom.js";
import { sumAmount } from "./aggregate.js";
import {
  renderWeekBars, renderCatChips, renderChart,
  renderCatList, renderEntryList, renderCalendar,
} from "./renderer.js";
import { setupCapture } from "./capture.js";

const MONTHS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

// ── 상태 ──
const now = new Date();
let currentYear = now.getFullYear();
let currentMonth = now.getMonth(); // 0~11
let cachedEntries = [];
let cachedBudget = 0;
let activeView = "add";
let editingIndex = -1;
let learnMap = {}; // 학습형 분류: normalize(가맹점) -> 카테고리

// ── Firebase 연결 (설정됐을 때만) ──
let getUser = () => null;
let loadMonth = null;
let saveMonth = null;
let loadMerchantMap = null;
let saveMerchantRule = null;

if (isConfigured) {
  const auth = await import("./auth.js");
  const store = await import("./store.js");
  getUser = auth.getUser;
  loadMonth = store.loadMonth;
  saveMonth = store.saveMonth;
  loadMerchantMap = store.loadMerchantMap;
  saveMerchantRule = store.saveMerchantRule;
  await auth.autoSignIn(); // 익명 자동 로그인 (가족 공용)
  try {
    if (getUser()) learnMap = await loadMerchantMap(); // 학습된 분류 불러오기
  } catch (e) {
    console.warn("학습 데이터 로드 실패", e);
  }
} else {
  document.querySelector("#config-banner").hidden = false;
}

// 가맹점 이름 정규화 (대소문자·공백·기호 제거 → OCR 변형에 덜 민감)
function normMerchant(s) {
  return String(s || "").toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

// 가맹점 → 카테고리: 학습된 게 있으면 우선, 없으면 규칙 기반
function smartCategory(merchant) {
  return learnMap[normMerchant(merchant)] || categorize(merchant);
}

// 사용자가 정한 카테고리를 학습(기억)합니다.
async function rememberRule(merchant, category) {
  const key = normMerchant(merchant);
  if (!key) return;
  learnMap[key] = category;
  if (saveMerchantRule && getUser()) {
    try {
      await saveMerchantRule(key, category);
    } catch (e) {
      console.warn("학습 저장 실패", e);
    }
  }
}

function fillCategorySelects() {
  const opts = CATS.map((c) => `<option>${c}</option>`).join("");
  $("category").innerHTML = opts;
  $("editCategory").innerHTML = opts;
}

// ── 데이터 로드/저장 ──
async function loadData() {
  if (!loadMonth || !getUser()) {
    cachedEntries = [];
    cachedBudget = 0;
    render();
    return;
  }
  showLoading(true);
  try {
    const data = await loadMonth(currentYear, currentMonth);
    cachedEntries = data.entries;
    cachedBudget = data.budget;
  } catch (e) {
    console.error(e);
  }
  showLoading(false);
  render();
}

async function saveData() {
  if (!saveMonth || !getUser()) {
    alert("아직 연결 중이에요. 잠시 후 다시 시도하세요.");
    return;
  }
  try {
    await saveMonth(currentYear, currentMonth, {
      entries: cachedEntries,
      budget: cachedBudget,
    });
  } catch (e) {
    console.error(e);
    alert("저장 오류. 인터넷 연결을 확인해주세요.");
  }
}

// ── 연도 이동 ──
function changeYear(delta) {
  currentYear += delta;
  buildMonthTabs();
  syncAddDate();
  loadData();
}

// ── 월별 탭 ──
function buildMonthTabs() {
  const container = $("monthTabs");
  $("yearLabel").textContent = currentYear + "년";
  container.innerHTML = "";
  MONTHS.forEach((m, i) => {
    const btn = document.createElement("button");
    btn.className = "month-tab" + (i === currentMonth ? " active" : "");
    btn.textContent = m;
    btn.onclick = () => {
      currentMonth = i;
      buildMonthTabs();
      syncAddDate();
      loadData();
    };
    container.appendChild(btn);
  });
  setTimeout(() => {
    const active = container.querySelector(".active");
    if (active) active.scrollIntoView({ inline: "center", behavior: "smooth" });
  }, 50);
}

// ── 렌더 ──
function render() {
  const entries = cachedEntries;
  const budget = cachedBudget;
  const expense = sumAmount(entries);
  const remain = budget - expense;
  const pct = budget > 0 ? Math.min(Math.round((expense / budget) * 100), 100) : 0;

  $("totalExpense").textContent = fmt(expense);
  $("totalBudget").textContent = budget > 0 ? fmt(budget) : "미설정";

  // 게이지 링: 둘레(2πr, r=53) 기준으로 사용 비율만큼 채움
  const CIRC = 2 * Math.PI * 53;
  const gauge = $("gaugeFg");
  const remainEl = $("remainBudget");
  if (budget > 0) {
    remainEl.textContent = remain < 0 ? `${fmt(-remain)} 초과` : fmt(remain);
    remainEl.style.color = remain < 0 ? "var(--red)" : "";
    gauge.setAttribute("stroke-dasharray", `${(pct / 100) * CIRC} ${CIRC}`);
    $("gaugePct").textContent = pct + "%";
    $("budgetUsedPct").textContent = "예산 사용";
  } else {
    remainEl.textContent = "—";
    remainEl.style.color = "var(--sub2)";
    gauge.setAttribute("stroke-dasharray", `0 ${CIRC}`);
    $("gaugePct").textContent = "—";
    $("budgetUsedPct").textContent = "예산 미설정";
  }

  renderWeekBars(entries, currentYear, currentMonth);
  renderCatChips(entries);
  renderChart(entries);
  renderCatList(entries);
  renderEntryList(entries);
  if (activeView === "cal") renderCalendar(cachedEntries, currentYear, currentMonth);
}

// ── 추가 ──
async function addEntry() {
  const category = $("category").value;
  const desc = $("desc").value.trim();
  const amount = parseInt($("amount").value);
  if (!desc || !amount || amount <= 0) {
    alert("내용과 금액을 입력해주세요!");
    return;
  }
  // 날짜: 보고 있는 달(currentMonth)로 고정하고, 고른 '일'만 사용 (월 불일치 방지)
  const d = new Date();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  const { last } = monthBounds();
  const dateVal = $("entryDate").value;
  let day = dateVal ? parseInt(dateVal.split("-")[2]) : d.getDate();
  if (!day || isNaN(day)) day = d.getDate();
  day = Math.min(Math.max(day, 1), last);
  const date = `${currentMonth + 1}/${day} ${hm}`;

  const entry = { category, desc, amount, date };

  // 동시 사용 대비: 저장 직전 최신본을 받아 거기에 추가 (다른 사람 내역 유실 방지)
  if (loadMonth && getUser()) {
    try {
      const fresh = await loadMonth(currentYear, currentMonth);
      cachedEntries = fresh.entries;
      cachedBudget = fresh.budget;
    } catch (e) {
      console.warn("최신본 조회 실패, 캐시에 추가", e);
    }
  }
  cachedEntries.push(entry);
  await saveData();
  render();
  $("desc").value = "";
  $("amount").value = "";
  syncAddDate();
}

// 현재 보고 있는 월(currentYear/currentMonth)의 날짜 범위
function monthBounds() {
  const last = new Date(currentYear, currentMonth + 1, 0).getDate();
  const mm = String(currentMonth + 1).padStart(2, "0");
  return {
    min: `${currentYear}-${mm}-01`,
    max: `${currentYear}-${mm}-${String(last).padStart(2, "0")}`,
    last,
  };
}

// 추가 폼의 날짜 입력을 "보고 있는 달"에 맞춰 동기화 (월 불일치 방지)
function syncAddDate() {
  const el = $("entryDate");
  if (!el) return;
  const { min, max } = monthBounds();
  el.min = min;
  el.max = max;
  const t = new Date();
  const isRealThisMonth = currentYear === t.getFullYear() && currentMonth === t.getMonth();
  el.value = isRealThisMonth
    ? `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`
    : min;
}

// ── 뷰 전환 ──
function switchView(view) {
  activeView = view;
  document.querySelectorAll(".view-tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  document.querySelectorAll(".view-panel").forEach((p) => p.classList.remove("active"));
  $("panel-" + view).classList.add("active");
  if (view === "chart") render();
  if (view === "cal") renderCalendar(cachedEntries, currentYear, currentMonth);
}

// ── 카테고리 상세 모달 ──
function openModal(cat) {
  const entries = cachedEntries.filter((e) => e.category === cat);
  const total = sumAmount(entries);
  $("modalTitle").textContent = `${CAT_ICONS[cat] || "📦"} ${cat} · ${fmt(total)}`;
  $("modalBody").innerHTML =
    entries.length === 0
      ? '<div class="empty">내역이 없어요</div>'
      : [...entries].reverse().map((e) => `<div class="detail-item"><div><div class="detail-desc">${esc(e.desc)}</div><div class="detail-meta">${esc(e.date)}</div></div><div class="detail-amt">-${fmt(e.amount)}</div></div>`).join("");
  $("modalOverlay").classList.add("open");
}

// ── 수정 모달 ──
function openEditModal(index) {
  const e = cachedEntries[index];
  if (!e) return;
  editingIndex = index;
  $("editCategory").value = e.category;
  $("editDesc").value = e.desc;
  $("editAmount").value = e.amount;
  // 날짜 입력 범위를 보고 있는 달로 제한 (월 불일치 방지)
  const { min, max } = monthBounds();
  $("editDate").min = min;
  $("editDate").max = max;
  try {
    const [datePart] = e.date.split(" ");
    const [, d] = datePart.split("/");
    $("editDate").value = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  } catch {
    $("editDate").value = "";
  }
  $("editModalOverlay").classList.add("open");
}

async function saveEdit() {
  if (editingIndex < 0) return;
  const desc = $("editDesc").value.trim();
  const amount = parseInt($("editAmount").value);
  const category = $("editCategory").value;
  if (!desc || !amount || amount <= 0) {
    alert("내용과 금액을 입력해주세요!");
    return;
  }
  // 날짜: 보고 있는 달로 고정, 고른 '일'만 반영 (월 불일치 방지)
  const oldDate = cachedEntries[editingIndex].date;
  const timePart = oldDate.includes(" ") ? oldDate.split(" ")[1] : "00:00";
  const { last } = monthBounds();
  const dateVal = $("editDate").value;
  let day;
  if (dateVal) {
    day = parseInt(dateVal.split("-")[2]);
  } else {
    day = parseInt((oldDate.split(" ")[0] || "").split("/")[1]);
  }
  if (!day || isNaN(day)) day = 1;
  day = Math.min(Math.max(day, 1), last);
  const newDate = `${currentMonth + 1}/${day} ${timePart}`;

  cachedEntries[editingIndex] = { ...cachedEntries[editingIndex], desc, amount, category, date: newDate };
  await saveData();
  rememberRule(desc, category); // 이 가맹점의 카테고리를 학습
  closeEditModal();
  render();
}

async function deleteEntry() {
  if (editingIndex < 0) return;
  if (!confirm("이 내역을 삭제할까요?")) return;
  cachedEntries.splice(editingIndex, 1);
  await saveData();
  closeEditModal();
  render();
}

function closeEditModal() {
  $("editModalOverlay").classList.remove("open");
  editingIndex = -1;
}
function closeCatModal() {
  $("modalOverlay").classList.remove("open");
}

// ── 예산 ──
async function saveBudget() {
  const val = parseInt($("budgetInput").value);
  if (!val || val <= 0) {
    alert("예산을 올바르게 입력해주세요!");
    return;
  }
  // 예산만 바꾸므로, 동시 추가된 내역을 덮어쓰지 않도록 최신 내역을 먼저 받음
  if (loadMonth && getUser()) {
    try {
      const fresh = await loadMonth(currentYear, currentMonth);
      cachedEntries = fresh.entries;
    } catch (e) {
      console.warn("최신본 조회 실패", e);
    }
  }
  cachedBudget = val;
  $("budgetInput").value = "";
  await saveData();
  render();
}

// ════════ 이벤트 연결 ════════
function wireEvents() {
  $("btnAdd").addEventListener("click", addEntry);
  $("btnBudget").addEventListener("click", saveBudget);

  // 연도 이동 ◀ ▶
  $("yearPrev").addEventListener("click", () => changeYear(-1));
  $("yearNext").addEventListener("click", () => changeYear(1));
  $("btnSaveEdit").addEventListener("click", saveEdit);
  $("btnDelete").addEventListener("click", deleteEntry);
  $("editClose").addEventListener("click", closeEditModal);
  $("modalClose").addEventListener("click", closeCatModal);

  // 뷰 탭
  document.querySelectorAll(".view-tab").forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view)));

  // 오버레이 바깥 클릭으로 닫기
  $("editModalOverlay").addEventListener("click", (e) => {
    if (e.target === $("editModalOverlay")) closeEditModal();
  });
  $("modalOverlay").addEventListener("click", (e) => {
    if (e.target === $("modalOverlay")) closeCatModal();
  });

  // 동적 목록들 (이벤트 위임)
  $("entryList").addEventListener("click", (e) => {
    const item = e.target.closest("[data-index]");
    if (item) openEditModal(Number(item.dataset.index));
  });
  $("dayEntryList").addEventListener("click", (e) => {
    const item = e.target.closest("[data-index]");
    if (item) openEditModal(Number(item.dataset.index));
  });
  $("catList").addEventListener("click", (e) => {
    const item = e.target.closest("[data-cat]");
    if (item) openModal(item.dataset.cat);
  });
  $("catChips").addEventListener("click", (e) => {
    const item = e.target.closest("[data-cat]");
    if (item) openModal(item.dataset.cat);
  });
  $("calGrid").addEventListener("click", (e) => {
    const cell = e.target.closest("[data-day]");
    if (cell) renderCalendar(cachedEntries, currentYear, currentMonth, Number(cell.dataset.day));
  });

  setupCapture({
    smartCategory,
    rememberRule,
    getUser,
    loadMonth,
    saveMonth,
    loadData,
    switchView,
    getYear: () => currentYear,
    getMonth: () => currentMonth,
  });
}

// ════════ 시작 ════════
fillCategorySelects();
wireEvents();
buildMonthTabs();
syncAddDate();
await loadData();

// PWA: 서비스워커 등록 (폰 홈화면 설치 + 오프라인 캐시)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW 등록 실패", e));
}
