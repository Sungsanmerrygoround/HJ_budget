// main.js — 한준♥이현 가계부 앱 컨트롤러
// 상태·데이터·라우팅을 담당하고, 렌더링은 renderer.js, OCR 흐름은 capture.js에 위임합니다.

import { categorize, normMerchant, CATS, CAT_ICONS } from "./categorize.js";
import { isConfigured } from "./firebase-config.js";
import { $, fmt, esc, showLoading, showToast } from "./dom.js";
import { sumAmount } from "./aggregate.js";
import { dayOf, timeOf, makeEntryDate, clampDay, toISO, todayISO, daysInMonth, parseISO } from "./datefmt.js";
import { entryKey, replaceEntry, removeEntry, byDateDesc } from "./entryops.js";
import { genId } from "./id.js";
import { getHouseholdId, shareLink, setHouseholdId, hidFromInput } from "./household.js";
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
// cachedEntries가 어느 달 것인지. 달을 옮기면 currentMonth는 바로 바뀌지만 내역은 불러온 뒤에야 바뀌므로,
// 그 사이 화면의 항목을 눌러 고쳐도 그 항목이 든 달을 고치도록 따로 기억함
let cachedMonth = { year: currentYear, month: currentMonth };
let loadSeq = 0; // 마지막으로 요청한 불러오기 번호 (늦게 온 옛 응답을 버리는 데 사용)
let activeView = "add";
// 편집 모달을 연 시점의 항목 스냅샷과 그 항목이 든 연·월 (저장 시점의 cachedEntries 변경이나,
// 모달을 열어 둔 사이 보고 있는 달이 바뀌어도(캡쳐 저장 후 이동 등) 원래 달의 그 항목을 고침)
let editing = null; // { entry, year, month }
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
let autoSignIn = null;

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
  autoSignIn = auth.autoSignIn;
} else {
  document.querySelector("#config-banner").hidden = false;
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
  const seq = ++loadSeq;
  const year = currentYear;
  const month = currentMonth;
  if (!loadMonth || !getUser()) {
    setCached(year, month, [], 0);
    render();
    return;
  }
  showLoading(true);
  let data = null;
  try {
    data = await loadMonth(year, month);
  } catch (e) {
    console.error(e);
  }
  // 그사이 다른 달로 옮겼거나 다시 불러왔으면, 늦게 온 이 응답은 버림 (9월 응답이 10월 화면을 덮지 않게)
  if (seq !== loadSeq) return;
  showLoading(false);
  if (data) {
    setCached(year, month, data.entries, data.budget);
  } else {
    // 못 불러왔을 때 다른 달 내역이 이 달 것처럼 남아 있으면 안 됨 (같은 달을 다시 불러오다 실패한 거면 그대로 둠)
    if (cachedMonth.year !== year || cachedMonth.month !== month) setCached(year, month, [], 0);
    showToast(`${month + 1}월 내역을 불러오지 못했어요. 인터넷 연결을 확인해주세요.`, "error");
  }
  render();
  if (activeView === "chart") loadAndRenderTrend();
}

function setCached(year, month, entries, budget) {
  cachedEntries = entries;
  cachedBudget = budget;
  cachedMonth = { year, month };
}

// 저장 중에 또 누르면(더블 탭) 무시 — 같은 내역이 두 번 저장되지 않게
function once(fn) {
  let running = false;
  return async (...args) => {
    if (running) return;
    running = true;
    try {
      await fn(...args);
    } finally {
      running = false;
    }
  };
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

// ── 연·월 이동 ──
// 캡쳐 저장 뒤 내역이 들어간 다른 달을 잠깐 보여줄 때, 원래 보던 달 ('추가' 탭으로 가면 여기로 돌아감)
// — 지난달을 보는 줄 모르고 오늘 지출을 넣으면 그 달 1일로 들어가 버리기 때문
let peekReturn = null;

// 보고 있는 연·월을 바꾸고 그 달을 불러옵니다.
function showMonth(year, month) {
  peekReturn = null; // 사용자가 직접 고른 달
  return goToMonth(year, month);
}

// 캡쳐로 다른 달에 추가했을 때, 그 달을 잠깐 보여줍니다.
function peekMonth(year, month) {
  if (year === currentYear && month === currentMonth) return loadData();
  if (!peekReturn) peekReturn = { year: currentYear, month: currentMonth };
  return goToMonth(year, month);
}

function goToMonth(year, month) {
  currentYear = year;
  currentMonth = month;
  searchQuery = '';
  const si = $("searchInput"); if (si) si.value = '';
  buildMonthTabs();
  syncAddDate();
  return loadData();
}

function changeYear(delta) {
  showMonth(currentYear + delta, currentMonth);
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
    btn.onclick = () => showMonth(currentYear, i);
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
  const { year, month } = cachedMonth;
  const expense = sumAmount(entries);
  const remain = budget - expense;
  const realPct = budget > 0 ? Math.round((expense / budget) * 100) : 0;
  const pct = Math.min(realPct, 100);

  // 다른 달을 보고 있을 때 '이번 달'로 읽히지 않게 달 이름을 붙임
  const label = `${year !== new Date().getFullYear() ? `${year}년 ` : ""}${month + 1}월`;
  $("heroLabel").textContent = `${label} 지출`;
  $("budgetInput").placeholder = `${label} 예산 (원)`;
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

  renderWeekBars(entries, year, month);
  renderCatChips(entries);
  renderChart(entries);
  renderCatList(entries);
  renderList();

  if (activeView === "cal") renderCalendar(entries, year, month);
}

// 검색어를 적용해 '내역' 목록만 그립니다. (날짜·시각 최신순)
// 검색은 목록에만 영향을 주므로, 타이핑마다 차트·게이지까지 다시 그리지 않습니다.
function renderList() {
  const entries = cachedEntries;
  const q = searchQuery.toLowerCase();
  // 내용·분류가 비어 있는 옛 데이터가 있어도 검색이 멈추지 않게 문자열로 바꿔 비교
  const visible = entries
    .map((e, i) => ({ ...e, _origIdx: i }))
    .filter((e) => !q || String(e.desc ?? "").toLowerCase().includes(q) || String(e.category ?? "").toLowerCase().includes(q))
    .sort(byDateDesc);
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
  // 날짜: 고른 날짜 그대로, 그 날짜가 속한 달 문서에 저장 (날짜 칸이 비었거나 깨졌으면 보고 있는 달의 오늘·말일).
  // 예전엔 보고 있는 달로 고정하고 '일'만 써서, 다른 달 날짜(아이폰은 날짜 칸의 범위 제한을 무시하기도 함)를
  // 고르면 9/30이 10/30으로 조용히 바뀌었음
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const picked = parseISO($("entryDate").value) ||
    { year: currentYear, month: currentMonth + 1, day: clampDay(now.getDate(), daysInMonth(currentYear, currentMonth + 1)) };
  const entry = { category, desc, amount, date: makeEntryDate(picked.month - 1, picked.day, hm), id: genId() };

  // 원자적 추가: 다른 가족이 동시에 넣은 내역을 덮어쓰지 않음
  try {
    await appendEntries(picked.year, picked.month - 1, [entry]);
  } catch (e) {
    reportSaveError(e);
    return;
  }
  $("desc").value = "";
  $("amount").value = "";
  syncAddDate();
  await loadData(); // 서버 최신본으로 갱신(다른 가족 추가분 포함) + 재렌더
  const otherMonth = picked.year !== currentYear || picked.month - 1 !== currentMonth;
  showToast(otherMonth ? `✅ ${picked.month}월 ${picked.day}일에 추가했어요 (${picked.month}월 탭에서 보여요)` : "✅ 추가됐어요!");
}

// 그 달(기본: 보고 있는 달, month는 0~11)의 날짜 범위
function monthBounds(year = currentYear, month = currentMonth) {
  const last = daysInMonth(year, month + 1);
  return { min: toISO(year, month + 1, 1), max: toISO(year, month + 1, last), last };
}

// 추가 폼의 날짜 기본값을 "보고 있는 달"에 맞춤 (이번 달이면 오늘, 다른 달이면 그 달 1일).
// 다른 달 날짜도 고를 수 있고, 고른 날짜의 달에 저장됨
function syncAddDate() {
  const el = $("entryDate");
  if (!el) return;
  const t = new Date();
  const isRealThisMonth = currentYear === t.getFullYear() && currentMonth === t.getMonth();
  el.value = isRealThisMonth ? todayISO(t) : monthBounds().min;
}

// ── 뷰 전환 ──
function switchView(view) {
  if (view === "add" && peekReturn) showMonth(peekReturn.year, peekReturn.month); // 잠깐 보여준 달 → 원래 달로
  activeView = view;
  document.querySelectorAll(".view-tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  document.querySelectorAll(".view-panel").forEach((p) => p.classList.remove("active"));
  $("panel-" + view).classList.add("active");
  if (view === "chart") { render(); loadAndRenderTrend(); }
  if (view === "cal") renderCalendar(cachedEntries, cachedMonth.year, cachedMonth.month);
}

// ── 카테고리 상세 모달 ──
function openModal(cat) {
  const entries = cachedEntries.filter((e) => e.category === cat).sort(byDateDesc);
  const total = sumAmount(entries);
  $("modalTitle").textContent = `${CAT_ICONS[cat] || "📦"} ${cat} · ${fmt(total)}`;
  $("modalBody").innerHTML =
    entries.length === 0
      ? '<div class="empty">내역이 없어요</div>'
      : entries.map((e) => `<div class="detail-item"><div><div class="detail-desc">${esc(e.desc)}</div><div class="detail-meta">${esc(e.date)}</div></div><div class="detail-amt">-${fmt(e.amount)}</div></div>`).join("");
  $("modalOverlay").classList.add("open");
}

// ── 수정 모달 ──
function openEditModal(index) {
  const e = cachedEntries[index];
  if (!e) return;
  // 저장 시점까지 이 스냅샷으로 항목을 식별. 달은 화면 탭이 아니라 이 항목을 불러온 달
  const { year, month } = cachedMonth;
  editing = { entry: e, year, month };
  // 목록에 없는 분류(옛 데이터)면 select가 빈 값이 돼 그대로 저장하면 분류가 사라지므로 '기타'로
  $("editCategory").value = CATS.includes(e.category) ? e.category : "기타";
  $("editDesc").value = e.desc ?? "";
  $("editAmount").value = e.amount;
  const d = dayOf(e.date);
  $("editDate").value = Number.isNaN(d) ? "" : toISO(year, month + 1, clampDay(d, daysInMonth(year, month + 1)));
  $("editModalOverlay").classList.add("open");
}

async function saveEdit() {
  if (!editing) return;
  const desc = $("editDesc").value.trim();
  const amount = parseInt($("editAmount").value);
  const category = $("editCategory").value;
  if (!desc || !amount || amount <= 0) {
    showToast("내용과 금액을 입력해주세요!", "error");
    return;
  }
  if (!ensureReady()) return;
  const { entry: target, year, month } = editing;
  const oldKey = entryKey(target); // 서버 최신본에서 이 항목을 찾을 키
  // 날짜: 고른 날짜 그대로 (비었거나 깨졌으면 원래 날짜). 시각은 원래 것을 유지
  const origDay = dayOf(target.date);
  const picked = parseISO($("editDate").value) ||
    { year, month: month + 1, day: clampDay(Number.isNaN(origDay) ? 1 : origDay, daysInMonth(year, month + 1)) };
  const moved = picked.year !== year || picked.month - 1 !== month; // 다른 달로 옮기는지
  // id가 없던 옛 항목이면 이번 편집에 id를 부여(자가 치유): 이후 arrayUnion 중복 오인·수정 오조준 방지
  const newEntry = { ...target, desc, amount, category, date: makeEntryDate(picked.month - 1, picked.day, timeOf(target.date)), id: target.id || genId() };

  let found = false;
  try {
    if (!moved) {
      // 트랜잭션: 최신 배열에서 키로 찾아 교체 (동시 편집에도 엉뚱한 항목 안 건드림)
      await mutateEntries(year, month, (arr) => {
        found = arr.some((e) => entryKey(e) === oldKey);
        return replaceEntry(arr, oldKey, newEntry);
      });
    } else {
      // 다른 달로 옮기기: 새 달에 먼저 넣고 옛 달에서 뺌 (중간에 끊겨도 내역이 사라지진 않게 — 최악은 양쪽에 남음)
      found = (await loadMonth(year, month)).entries.some((e) => entryKey(e) === oldKey);
      if (found) {
        await appendEntries(picked.year, picked.month - 1, [newEntry]);
        await mutateEntries(year, month, (arr) => removeEntry(arr, oldKey));
      }
    }
  } catch (e) {
    reportSaveError(e);
    return;
  }
  closeEditModal();
  await loadData();
  if (!found) {
    showToast("이미 지워진 내역이에요 (다른 기기에서 지웠을 수 있어요).", "error");
    return;
  }
  rememberRule(desc, category);
  showToast(moved ? `✅ ${picked.month}월 ${picked.day}일로 옮겼어요` : "✅ 수정했어요!");
}

async function deleteEntry() {
  if (!editing) return;
  if (!confirm("이 내역을 삭제할까요?")) return;
  if (!ensureReady()) return;
  const { entry, year, month } = editing;
  const oldKey = entryKey(entry);
  let found = false;
  try {
    await mutateEntries(year, month, (arr) => {
      found = arr.some((e) => entryKey(e) === oldKey);
      return removeEntry(arr, oldKey);
    });
  } catch (e) {
    reportSaveError(e);
    return;
  }
  closeEditModal();
  await loadData();
  showToast(found ? "🗑 삭제했어요" : "이미 지워진 내역이에요.");
}

function closeEditModal() {
  $("editModalOverlay").classList.remove("open");
  editing = null;
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
  // 예산만 원자적으로 갱신 — entries는 건드리지 않아 동시 추가분과 충돌 없음 (화면에 보이는 달의 예산)
  try {
    await setBudget(cachedMonth.year, cachedMonth.month, val);
  } catch (e) {
    reportSaveError(e);
    return;
  }
  $("budgetInput").value = "";
  await loadData();
  showToast("✅ 예산을 설정했어요!");
}

// ── 최근 6개월 추이 로드 ──
let trendSeq = 0;
async function loadAndRenderTrend() {
  if (!loadMonth || !getUser()) return;
  const section = $("trendSection");
  if (!section) return;
  const seq = ++trendSeq;
  const { year, month } = cachedMonth;
  const entries = cachedEntries;
  const targets = [];
  for (let i = 5; i >= 0; i--) {
    let y = year, m = month - i;
    while (m < 0) { m += 12; y--; }
    targets.push({ y, m });
  }
  // 6개월치는 서로 독립적이라 병렬 조회. 보고 있는 달은 이미 cachedEntries에 있으니 재조회 생략.
  const results = await Promise.all(targets.map(({ y, m }) =>
    (y === year && m === month)
      ? Promise.resolve({ entries })
      : loadMonth(y, m).catch(() => ({ entries: [] }))
  ));
  if (seq !== trendSeq) return; // 그사이 다른 달로 옮겨 다시 그렸으면 늦게 온 이 결과는 버림
  const months = targets.map(({ m }, i) => ({ label: `${m + 1}월`, total: sumAmount(results[i].entries) }));
  section.hidden = false;
  renderMonthlyTrend(months);
}

// ════════ 이벤트 연결 ════════
function wireEvents() {
  $("btnAdd").addEventListener("click", once(addEntry));
  $("btnBudget").addEventListener("click", once(saveBudget));

  // 연도 이동 ◀ ▶
  $("yearPrev").addEventListener("click", () => changeYear(-1));
  $("yearNext").addEventListener("click", () => changeYear(1));
  $("btnSaveEdit").addEventListener("click", once(saveEdit));
  $("btnDelete").addEventListener("click", once(deleteEntry));
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
    if (cell) renderCalendar(cachedEntries, cachedMonth.year, cachedMonth.month, Number(cell.dataset.day));
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
    peekMonth,
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
        "\n\n※ 홈 화면 앱에서 다른 기기의 코드로 바꾸려면, 아래에 그 코드(또는 받은 초대 링크)를 붙여넣고 확인을 누르세요.",
        current
      );
      // 코드 대신 받은 초대 링크를 통째로 붙여넣는 경우가 많아, 링크면 그 안의 코드를 꺼냄
      const code = hidFromInput(pasted);
      if (code && code !== current) {
        if (setHouseholdId(code)) {
          showToast("✅ 가족 코드를 바꿨어요. 새로고침할게요...");
          location.reload();
        } else {
          showToast("코드 형식이 올바르지 않아요.", "error");
        }
      }
    });
  }
}

// ════════ 시작 ════════
// UI를 먼저 그리고 이벤트를 연결한다 — 버튼이 로그인 완료(네트워크 왕복)를 기다리지
// 않고 즉시 반응하게 하려는 것. 저장이 필요한 동작은 각 핸들러의 ensureReady()가
// "연결 중" 안내를 띄우고, 초대 링크 버튼은 localStorage만 쓰므로 로그인과 무관하게 동작한다.
fillCategorySelects();
wireEvents();
buildMonthTabs();
syncAddDate();

// 그 다음에 (느릴 수 있는) 익명 로그인 → 학습 데이터 → 이번 달 로드
if (isConfigured) {
  await autoSignIn(); // 익명 자동 로그인 (가족 공용)
  try {
    if (getUser()) learnMap = await loadMerchantMap(); // 학습된 분류 불러오기
  } catch (e) {
    console.warn("학습 데이터 로드 실패", e);
  }
}
await loadData();

// PWA: 서비스워커 등록 (폰 홈화면 설치 + 오프라인 캐시)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW 등록 실패", e));
}
