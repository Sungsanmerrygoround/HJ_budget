// main.js — 한준♥이현 가계부 앱 컨트롤러
// 상태·데이터·라우팅을 담당하고, 렌더링은 renderer.js, OCR 흐름은 capture.js에 위임합니다.

import { categorize, CATS, CAT_ICONS } from "./categorize.js";
import { isConfigured } from "./firebase-config.js";
import { $, fmt, esc, showLoading, showToast } from "./dom.js";
import { sumAmount } from "./aggregate.js";
import { dayOf, timeOf, makeEntryDate, clampDay } from "./datefmt.js";
import { entryKey, replaceEntry, removeEntry } from "./entryops.js";
import { genId } from "./id.js";
import { getHouseholdId, shareLink, setHouseholdId } from "./household.js";
import {
  renderWeekBars, renderCatChips, renderChart,
  renderCatList, renderEntryList, renderCalendar,
  renderMonthlyTrend, updateGaugeColors,
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
let editingEntry = null; // 편집 모달을 연 시점의 항목 스냅샷 (저장 시점의 cachedEntries 변경에 영향받지 않음)
let searchQuery = '';
let learnMap = {}; // 학습형 분류: normalize(가맹점) -> 카테고리

// ── Firebase 연결 (설정됐을 때만) ──
let getUser = () => null;
let loadMonth = null;
let appendEntries = null;
let setBudget = null;
let mutateEntries = null;
let loadMerchantMap = null;
let saveMerchantRule = null;

if (isConfigured) {
  const auth = await import("./auth.js");
  const store = await import("./store.js");
  getUser = auth.getUser;
  loadMonth = store.loadMonth;
  appendEntries = store.appendEntries;
  setBudget = store.setBudget;
  mutateEntries = store.mutateEntries;
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
  if (activeView === "chart") loadAndRenderTrend();
}

// 저장 가능한 상태(로그인 완료 + Firebase 연결)인지 확인합니다.
function ensureReady() {
  if (!getUser() || !appendEntries) {
    showToast("아직 연결 중이에요. 잠시 후 다시 시도하세요.", "error");
    return false;
  }
  return true;
}

// 저장 오류를 사용자에게 알립니다(네트워크 문제 등).
function reportSaveError(e) {
  console.error(e);
  showToast("저장 오류. 인터넷 연결을 확인해주세요.", "error");
}

// ── 연도 이동 ──
function changeYear(delta) {
  currentYear += delta;
  searchQuery = '';
  const si = $("searchInput"); if (si) si.value = '';
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
      searchQuery = '';
      const si = $("searchInput"); if (si) si.value = '';
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
  const realPct = budget > 0 ? Math.round((expense / budget) * 100) : 0;
  const pct = Math.min(realPct, 100);

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
    $("gaugePct").textContent = realPct + "%";
    $("budgetUsedPct").textContent = "예산 사용";
  } else {
    remainEl.textContent = "—";
    remainEl.style.color = "var(--sub2)";
    gauge.setAttribute("stroke-dasharray", `0 ${CIRC}`);
    $("gaugePct").textContent = "—";
    $("budgetUsedPct").textContent = "예산 미설정";
  }
  updateGaugeColors(realPct);
  gauge.classList.toggle("gauge-danger", realPct >= 100);

  renderWeekBars(entries, currentYear, currentMonth);
  renderCatChips(entries);
  renderChart(entries);
  renderCatList(entries);
  renderList();

  if (activeView === "cal") renderCalendar(cachedEntries, currentYear, currentMonth);
}

// 검색어를 적용해 '내역' 목록만 그립니다.
// 검색은 목록에만 영향을 주므로, 타이핑마다 차트·게이지까지 다시 그리지 않습니다.
function renderList() {
  const entries = cachedEntries;
  const tagged = entries.map((e, i) => ({ ...e, _origIdx: i }));
  const visible = searchQuery
    ? tagged.filter((e) =>
        e.desc.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.category.includes(searchQuery))
    : tagged;
  const emptyMsg = searchQuery && entries.length > 0
    ? "검색 결과가 없어요"
    : "아직 기록이 없어요 💙<br>오늘 첫 소비를 담아볼까요?";
  renderEntryList(visible, emptyMsg);
}

// ── 추가 ──
async function addEntry() {
  const category = $("category").value;
  const desc = $("desc").value.trim();
  const amount = parseInt($("amount").value);
  if (!desc || !amount || amount <= 0) {
    showToast("내용과 금액을 입력해주세요!", "error");
    return;
  }
  if (!ensureReady()) return;
  // 날짜: 보고 있는 달(currentMonth)로 고정하고, 고른 '일'만 사용 (월 불일치 방지)
  const d = new Date();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  const { last } = monthBounds();
  const day = resolveDay($("entryDate").value, d.getDate(), last);
  const date = makeEntryDate(currentMonth, day, hm);

  const entry = { category, desc, amount, date, id: genId() };

  // 원자적 추가: 다른 가족이 동시에 넣은 내역을 덮어쓰지 않음
  try {
    await appendEntries(currentYear, currentMonth, [entry]);
  } catch (e) {
    reportSaveError(e);
    return;
  }
  $("desc").value = "";
  $("amount").value = "";
  syncAddDate();
  await loadData(); // 서버 최신본으로 갱신(다른 가족 추가분 포함) + 재렌더
  showToast("✅ 추가됐어요!");
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

// 날짜 입력값('YYYY-MM-DD')에서 '일'을 뽑아 월 범위(last)로 맞춥니다.
// 입력이 비었거나 깨졌으면 fallbackDay(항상 유효한 값)를 씁니다.
function resolveDay(inputVal, fallbackDay, last) {
  let day = inputVal ? parseInt(inputVal.split("-")[2]) : fallbackDay;
  if (!day || isNaN(day)) day = fallbackDay;
  return clampDay(day, last);
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
  if (view === "chart") { render(); loadAndRenderTrend(); }
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
  editingEntry = e; // 저장 시점까지 이 스냅샷으로 항목을 식별 (그사이 목록이 갱신돼도 안전)
  $("editCategory").value = e.category;
  $("editDesc").value = e.desc;
  $("editAmount").value = e.amount;
  // 날짜 입력 범위를 보고 있는 달로 제한 (월 불일치 방지)
  const { min, max } = monthBounds();
  $("editDate").min = min;
  $("editDate").max = max;
  const d = dayOf(e.date);
  $("editDate").value = Number.isNaN(d)
    ? ""
    : `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  $("editModalOverlay").classList.add("open");
}

async function saveEdit() {
  if (!editingEntry) return;
  const desc = $("editDesc").value.trim();
  const amount = parseInt($("editAmount").value);
  const category = $("editCategory").value;
  if (!desc || !amount || amount <= 0) {
    showToast("내용과 금액을 입력해주세요!", "error");
    return;
  }
  if (!ensureReady()) return;
  const target = editingEntry;
  const oldKey = entryKey(target); // 서버 최신본에서 이 항목을 찾을 키
  // 날짜: 보고 있는 달로 고정, 고른 '일'만 반영 (월 불일치 방지)
  const oldDate = target.date;
  const timePart = timeOf(oldDate);
  const { last } = monthBounds();
  const origDay = dayOf(oldDate);
  const day = resolveDay($("editDate").value, (!origDay || isNaN(origDay)) ? 1 : origDay, last);
  const newDate = makeEntryDate(currentMonth, day, timePart);
  // id가 없던 옛 항목이면 이번 편집에 id를 부여(자가 치유): 이후 arrayUnion 중복 오인·수정 오조준 방지
  const newEntry = { ...target, desc, amount, category, date: newDate, id: target.id || genId() };

  // 트랜잭션: 최신 배열에서 키로 찾아 교체 (동시 편집에도 엉뚱한 항목 안 건드림)
  try {
    await mutateEntries(currentYear, currentMonth, (arr) => replaceEntry(arr, oldKey, newEntry));
  } catch (e) {
    reportSaveError(e);
    return;
  }
  rememberRule(desc, category);
  closeEditModal();
  await loadData();
  showToast("✅ 수정했어요!");
}

async function deleteEntry() {
  if (!editingEntry) return;
  if (!confirm("이 내역을 삭제할까요?")) return;
  if (!ensureReady()) return;
  const oldKey = entryKey(editingEntry);
  try {
    await mutateEntries(currentYear, currentMonth, (arr) => removeEntry(arr, oldKey));
  } catch (e) {
    reportSaveError(e);
    return;
  }
  closeEditModal();
  await loadData();
  showToast("🗑 삭제했어요");
}

function closeEditModal() {
  $("editModalOverlay").classList.remove("open");
  editingEntry = null;
}
function closeCatModal() {
  $("modalOverlay").classList.remove("open");
}

// ── 예산 ──
async function saveBudget() {
  const val = parseInt($("budgetInput").value);
  if (!val || val <= 0) {
    showToast("예산을 올바르게 입력해주세요!", "error");
    return;
  }
  if (!ensureReady()) return;
  // 예산만 원자적으로 갱신 — entries는 건드리지 않아 동시 추가분과 충돌 없음
  try {
    await setBudget(currentYear, currentMonth, val);
  } catch (e) {
    reportSaveError(e);
    return;
  }
  $("budgetInput").value = "";
  await loadData();
  showToast("✅ 예산을 설정했어요!");
}

// ── 최근 6개월 추이 로드 ──
async function loadAndRenderTrend() {
  if (!loadMonth || !getUser()) return;
  const section = $("trendSection");
  if (!section) return;
  const targets = [];
  for (let i = 5; i >= 0; i--) {
    let y = currentYear, m = currentMonth - i;
    while (m < 0) { m += 12; y--; }
    targets.push({ y, m });
  }
  // 6개월치는 서로 독립적이라 병렬 조회. 현재 보고 있는 달은 이미 cachedEntries에 있으니 재조회 생략.
  const results = await Promise.all(targets.map(({ y, m }) =>
    (y === currentYear && m === currentMonth)
      ? Promise.resolve({ entries: cachedEntries })
      : loadMonth(y, m).catch(() => ({ entries: [] }))
  ));
  const months = targets.map(({ m }, i) => ({ label: `${m + 1}월`, total: sumAmount(results[i].entries) }));
  section.hidden = false;
  renderMonthlyTrend(months);
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

  // 동적 목록들 (이벤트 위임) — 내역/달력 목록 모두 같은 클릭 처리
  const onEntryClick = (e) => {
    const item = e.target.closest("[data-index]");
    if (item) openEditModal(Number(item.dataset.index));
  };
  $("entryList").addEventListener("click", onEntryClick);
  $("dayEntryList").addEventListener("click", onEntryClick);
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

  $("searchInput").addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    renderList(); // 검색은 목록만 갱신 (차트·게이지 재렌더 안 함)
  });

  setupCapture({
    smartCategory,
    rememberRule,
    getUser,
    loadMonth,
    appendEntries,
    loadData,
    switchView,
    getYear: () => currentYear,
    getMonth: () => currentMonth,
  });

  // 가족 초대 링크 복사
  const invite = $("inviteBtn");
  if (invite) {
    invite.addEventListener("click", async () => {
      const current = getHouseholdId();
      const link = shareLink(current);
      try {
        await navigator.clipboard.writeText(link);
        showToast("🔗 가족 초대 링크를 복사했어요!");
      } catch {
        // 클립보드가 막힌 환경: 링크를 눈으로 보여줌
      }
      // iOS 홈 화면 앱은 ?h= 링크로 열어도 manifest의 start_url("./")을 써서
      // 코드가 전달되지 않으므로, 직접 붙여넣어 전환할 수 있는 창구를 함께 제공.
      const pasted = prompt(
        "가족 초대 링크를 복사했어요:\n" + link +
        "\n\n※ 홈 화면 앱에서 다른 기기의 코드로 바꾸려면, 아래에 그 코드를 붙여넣고 확인을 누르세요.",
        current
      );
      if (pasted && pasted.trim() && pasted.trim() !== current) {
        setHouseholdId(pasted.trim());
        showToast("✅ 가족 코드를 바꿨어요. 새로고침할게요...");
        location.reload();
      }
    });
  }
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
