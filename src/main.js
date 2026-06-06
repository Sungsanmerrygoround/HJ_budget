// main.js — snap-budget 앱 컨트롤러
// 기존 가계부의 모든 기능(월별 탭·예산·차트·달력·내역·수정모달)
// + 캡쳐 OCR 자동입력(📷)을 한곳에서 조립합니다.

import { extractText } from "./ocr.js";
import { parseTransactions } from "./parse.js";
import { categorize, CATS, CAT_ICONS, CAT_COLORS, catColor } from "./categorize.js";
import { isConfigured } from "./firebase-config.js";

const MONTHS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

// ── 상태 ──
const now = new Date();
let currentYear = now.getFullYear();
let currentMonth = now.getMonth(); // 0~11
let cachedEntries = [];
let cachedBudget = 0;
let activeView = "add";
let editingIndex = -1;
let chartInstance = null;
let capItems = []; // 캡쳐로 인식한 임시 항목들
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
  await auth.autoSignIn(); // 가족 공용 계정 자동 로그인
  try {
    if (getUser()) learnMap = await loadMerchantMap(getUser().uid); // 학습된 분류 불러오기
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
      await saveMerchantRule(getUser().uid, key, category);
    } catch (e) {
      console.warn("학습 저장 실패", e);
    }
  }
}

// ── 도우미 ──
const $ = (id) => document.getElementById(id);
const fmt = (n) => (Number(n) || 0).toLocaleString("ko-KR") + "원";
const showLoading = (on) => ($("loadingBar").style.display = on ? "block" : "none");
const esc = (s) =>
  String(s ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

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
    const data = await loadMonth(getUser().uid, currentYear, currentMonth);
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
    alert("로그인이 필요해요. 새로고침해보세요.");
    return;
  }
  try {
    await saveMonth(getUser().uid, currentYear, currentMonth, {
      entries: cachedEntries,
      budget: cachedBudget,
    });
  } catch (e) {
    console.error(e);
    alert("저장 오류. 인터넷 연결을 확인해주세요.");
  }
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
  const expense = entries.reduce((s, e) => s + e.amount, 0);
  const remain = budget - expense;
  const pct = budget > 0 ? Math.min(Math.round((expense / budget) * 100), 100) : 0;

  $("totalExpense").textContent = fmt(expense);
  $("totalBudget").textContent = budget > 0 ? fmt(budget) : "미설정";

  const fill = $("budgetFill");
  const remainEl = $("remainBudget");
  if (budget > 0) {
    remainEl.textContent = fmt(Math.max(remain, 0));
    remainEl.style.color = remain < 0 ? "var(--red)" : "var(--primary)";
    fill.style.width = pct + "%";
    fill.style.background = pct >= 90 ? "var(--red)" : pct >= 70 ? "#F97316" : "var(--primary)";
    $("budgetUsedPct").textContent = `${pct}% 사용`;
    $("budgetUsedAmt").textContent = remain < 0 ? `${fmt(-remain)} 초과` : `${fmt(remain)} 남음`;
  } else {
    remainEl.textContent = "—";
    remainEl.style.color = "var(--sub2)";
    fill.style.width = "0%";
    $("budgetUsedPct").textContent = "예산을 설정해주세요";
    $("budgetUsedAmt").textContent = "";
  }

  renderChart(entries);
  renderCatList(entries);
  renderEntryList(entries);
  if (activeView === "cal") renderCalendar();
}

function renderChart(entries) {
  const totals = CATS.map((c) => entries.filter((e) => e.category === c).reduce((s, e) => s + e.amount, 0));
  const hasData = totals.some((t) => t > 0);
  const ctx = $("myChart").getContext("2d");
  if (chartInstance) chartInstance.destroy();
  if (!hasData) {
    chartInstance = null;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.font = "500 13px Outfit, Noto Sans KR, sans-serif";
    ctx.fillStyle = "#9CA3AF";
    ctx.textAlign = "center";
    ctx.fillText("지출 내역이 없어요", ctx.canvas.width / 2, 100);
    return;
  }
  const filtered = CATS.map((c, i) => ({ label: c, value: totals[i], color: CAT_COLORS[i] })).filter((d) => d.value > 0);
  chartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: filtered.map((d) => d.label),
      datasets: [
        {
          data: filtered.map((d) => d.value),
          backgroundColor: filtered.map((d) => d.color + "1A"),
          borderColor: filtered.map((d) => d.color),
          borderWidth: 2.5,
          hoverOffset: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "right",
          labels: { font: { size: 11, family: "Outfit, Noto Sans KR, sans-serif", weight: "500" }, color: "#6B7280", padding: 10, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "circle" },
        },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.parsed.toLocaleString("ko-KR")}원` } },
      },
    },
  });
}

function renderCatList(entries) {
  const maxTotal = Math.max(...CATS.map((c) => entries.filter((e) => e.category === c).reduce((s, e) => s + e.amount, 0)), 1);
  const container = $("catList");
  const rows = CATS.map((cat, i) => ({ cat, total: entries.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0), i }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
  if (rows.length === 0) {
    container.innerHTML = '<div class="empty">지출 내역이 없어요</div>';
    return;
  }
  container.innerHTML = rows
    .map(({ cat, total, i }) => `
      <div class="cat-item" data-cat="${cat}">
        <div class="cat-header"><div class="cat-name">${CAT_ICONS[cat] || "📦"} ${cat}</div><div class="cat-total">${fmt(total)}</div></div>
        <div class="cat-bar-bg"><div class="cat-bar" style="width:${Math.round((total / maxTotal) * 100)}%;background:${CAT_COLORS[i]}"></div></div>
      </div>`)
    .join("");
}

function renderEntryList(entries) {
  const container = $("entryList");
  if (entries.length === 0) {
    container.innerHTML = '<div class="empty">아직 내역이 없어요</div>';
    return;
  }
  container.innerHTML = entries
    .map((e, i) => ({ ...e, realIndex: i }))
    .reverse()
    .map((e) => `
      <div class="entry-item" data-index="${e.realIndex}">
        <div><div class="entry-desc">${esc(e.desc)} <span style="font-size:11px;color:var(--sub2)">[${e.category}]</span></div><div class="entry-meta">${e.date} · 탭해서 수정</div></div>
        <div class="entry-amt-expense">-${fmt(e.amount)}</div>
      </div>`)
    .join("");
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
  const dateVal = $("entryDate").value;
  let date;
  const d = new Date();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (dateVal) {
    const [, mm, dd] = dateVal.split("-");
    date = `${parseInt(mm)}/${parseInt(dd)} ${hm}`;
  } else {
    date = `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }
  cachedEntries.push({ category, desc, amount, date });
  await saveData();
  render();
  $("desc").value = "";
  $("amount").value = "";
  setTodayDate();
}

function setTodayDate() {
  const t = new Date();
  $("entryDate").value = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

// ── 뷰 전환 ──
function switchView(view) {
  activeView = view;
  document.querySelectorAll(".view-tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  document.querySelectorAll(".view-panel").forEach((p) => p.classList.remove("active"));
  $("panel-" + view).classList.add("active");
  if (view === "chart") render();
  if (view === "cal") renderCalendar();
}

// ── 달력 ──
function renderCalendar(selectedDay) {
  const entries = cachedEntries;
  const year = currentYear, month = currentMonth;
  const today = new Date();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dayMap = {};
  entries.forEach((e) => {
    const dayStr = e.date.split(" ")[0];
    if (!dayMap[dayStr]) dayMap[dayStr] = [];
    dayMap[dayStr].push(e);
  });
  const grid = $("calGrid");
  let html = "";
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-cell empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = `${month + 1}/${d}`;
    const dayEntries = dayMap[dayStr] || [];
    const total = dayEntries.reduce((s, e) => s + e.amount, 0);
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
    const hasData = dayEntries.length > 0;
    html += `<div class="cal-cell ${hasData ? "has-data" : ""} ${isToday ? "today" : ""} ${selectedDay === d ? "selected-day" : ""}" ${hasData ? `data-day="${d}"` : ""}>
      <div class="cal-day">${d}</div>${total > 0 ? `<div class="cal-amt">${(total / 10000).toFixed(1)}만</div>` : ""}</div>`;
  }
  grid.innerHTML = html;
  if (selectedDay) {
    const dayStr = `${month + 1}/${selectedDay}`;
    const dayEntries = dayMap[dayStr] || [];
    const total = dayEntries.reduce((s, e) => s + e.amount, 0);
    $("dayDetailTitle").textContent = `${month + 1}월 ${selectedDay}일 · ${fmt(total)}`;
    $("dayEntryList").innerHTML = dayEntries
      .map((e) => `
        <div class="entry-item" data-index="${entries.indexOf(e)}">
          <div><div class="entry-desc">${esc(e.desc)} <span style="font-size:11px;color:var(--sub2)">[${e.category}]</span></div><div class="entry-meta">${e.date} · 탭해서 수정</div></div>
          <div class="entry-amt-expense">-${fmt(e.amount)}</div>
        </div>`)
      .join("");
    $("dayDetail").style.display = "block";
  } else {
    $("dayDetail").style.display = "none";
  }
}

// ── 카테고리 상세 모달 ──
function openModal(cat) {
  const entries = cachedEntries.filter((e) => e.category === cat);
  const total = entries.reduce((s, e) => s + e.amount, 0);
  $("modalTitle").textContent = `${CAT_ICONS[cat]} ${cat} · ${fmt(total)}`;
  $("modalBody").innerHTML =
    entries.length === 0
      ? '<div class="empty">내역이 없어요</div>'
      : [...entries].reverse().map((e) => `<div class="detail-item"><div><div class="detail-desc">${esc(e.desc)}</div><div class="detail-meta">${e.date}</div></div><div class="detail-amt">-${fmt(e.amount)}</div></div>`).join("");
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
  try {
    const [datePart] = e.date.split(" ");
    const [m, d] = datePart.split("/");
    $("editDate").value = `${currentYear}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
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
  let newDate = cachedEntries[editingIndex].date;
  const dateVal = $("editDate").value;
  if (dateVal) {
    const [, mm, dd] = dateVal.split("-");
    const timePart = newDate.includes(" ") ? newDate.split(" ")[1] : "00:00";
    newDate = `${parseInt(mm)}/${parseInt(dd)} ${timePart}`;
  }
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
  cachedBudget = val;
  $("budgetInput").value = "";
  await saveData();
  render();
}

// ════════ 📷 캡쳐 OCR 흐름 ════════
function setupCapture() {
  const capFile = $("capFile");
  const capPreview = $("capPreview");
  const capOcrBtn = $("capOcrBtn");
  const capStatus = $("capStatus");
  const capEditor = $("capEditor");
  let selectedFile = null;

  capFile.addEventListener("change", () => {
    const file = capFile.files[0];
    if (!file) return;
    selectedFile = file;
    capPreview.classList.remove("empty");
    capPreview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="캡쳐 미리보기" />`;
    capOcrBtn.hidden = false;
    capEditor.hidden = true;
    capStatus.hidden = true;
  });

  capOcrBtn.addEventListener("click", async () => {
    if (!selectedFile) return;
    capOcrBtn.disabled = true;
    capStatus.hidden = false;
    capStatus.textContent = "글자 인식 준비 중... (처음엔 한글 데이터 받느라 조금 걸려요)";
    try {
      const text = await extractText(selectedFile, (pct) => (capStatus.textContent = `글자 인식 중... ${pct}%`));
      const { expenses, excludedIncome } = parseTransactions(text);
      capItems = expenses.map((e) => ({
        desc: e.merchant,
        category: smartCategory(e.merchant), // 학습된 분류 우선
        amount: e.amount,
        dateISO: e.date,
        time: e.time,
      }));
      capStatus.textContent =
        `지출 ${capItems.length}건 인식${excludedIncome > 0 ? ` (수입 ${excludedIncome}건 제외)` : ""}. 확인·수정 후 '전체 추가'를 누르세요.`;
      renderCapEditor();
    } catch (err) {
      console.error(err);
      capStatus.textContent = "⚠️ 인식 중 오류가 났어요. 콘솔(F12)을 확인하세요.";
    } finally {
      capOcrBtn.disabled = false;
    }
  });

  // 캡쳐 에디터 안의 입력/삭제/추가 처리 (이벤트 위임)
  capEditor.addEventListener("input", (ev) => {
    const row = ev.target.closest(".cap-row");
    if (!row) return;
    const i = Number(row.dataset.i);
    if (ev.target.classList.contains("cap-desc")) capItems[i].desc = ev.target.value;
    else if (ev.target.classList.contains("cap-amt")) {
      capItems[i].amount = Number(ev.target.value) || 0;
      updateCapTotal();
    }
  });
  capEditor.addEventListener("change", (ev) => {
    const row = ev.target.closest(".cap-row");
    if (!row) return;
    const i = Number(row.dataset.i);
    if (ev.target.classList.contains("cap-cat")) {
      capItems[i].category = ev.target.value;
      rememberRule(capItems[i].desc, ev.target.value); // 고친 분류를 학습
    }
  });
  capEditor.addEventListener("click", (ev) => {
    if (ev.target.classList.contains("cap-del")) {
      const row = ev.target.closest(".cap-row");
      capItems.splice(Number(row.dataset.i), 1);
      renderCapEditor();
    } else if (ev.target.id === "capImport") {
      importCaptured();
    }
  });

  function renderCapEditor() {
    if (capItems.length === 0) {
      capEditor.innerHTML = `<div class="empty">인식된 지출이 없어요. 다른 캡쳐를 올려보세요.</div>`;
      capEditor.hidden = false;
      return;
    }
    const rows = capItems
      .map((it, i) => `
        <div class="cap-row" data-i="${i}">
          <input class="cap-desc" value="${esc(it.desc)}" />
          <select class="cap-cat">${CATS.map((c) => `<option ${c === it.category ? "selected" : ""}>${c}</option>`).join("")}</select>
          <input class="cap-amt" type="number" inputmode="numeric" value="${it.amount}" />
          <button class="cap-del" title="삭제">🗑</button>
        </div>`)
      .join("");
    capEditor.innerHTML =
      rows +
      `<div class="cap-import-row"><span class="total">합계 <b>${fmt(capTotal())}</b> · ${capItems.length}건</span><button class="btn-add cap-import-btn" id="capImport">전체 추가</button></div>`;
    capEditor.hidden = false;
  }

  function capTotal() {
    return capItems.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  }
  function updateCapTotal() {
    const el = capEditor.querySelector(".total b");
    if (el) el.textContent = fmt(capTotal());
  }

  async function importCaptured() {
    if (capItems.length === 0) return;
    const uid = getUser()?.uid;
    if (!uid) {
      alert("로그인이 필요해요. 새로고침해보세요.");
      return;
    }
    showLoading(true);
    // 각 항목을 날짜가 속한 '월'로 묶어서 그 월 문서에 추가
    const groups = {};
    for (const it of capItems) {
      const d = new Date((it.dateISO || "") + "T00:00:00");
      const valid = !isNaN(d.getTime());
      const y = valid ? d.getFullYear() : currentYear;
      const m = valid ? d.getMonth() : currentMonth;
      const day = valid ? d.getDate() : new Date().getDate();
      const key = `${y}_${m}`;
      if (!groups[key]) groups[key] = { year: y, month: m, entries: [] };
      groups[key].entries.push({
        category: it.category,
        desc: it.desc,
        amount: Number(it.amount) || 0,
        date: `${m + 1}/${day} ${it.time || "00:00"}`,
      });
    }
    let added = 0;
    try {
      for (const key in groups) {
        const g = groups[key];
        const data = await loadMonth(uid, g.year, g.month);
        const merged = [...(data.entries || []), ...g.entries];
        await saveMonth(uid, g.year, g.month, { entries: merged, budget: data.budget || 0 });
        added += g.entries.length;
      }
    } catch (e) {
      console.error(e);
      showLoading(false);
      alert("저장 오류. 인터넷 연결을 확인해주세요.");
      return;
    }
    showLoading(false);

    // 캡쳐 화면 정리
    capItems = [];
    capEditor.hidden = true;
    capPreview.classList.add("empty");
    capPreview.innerHTML = "<span>고른 캡쳐가 여기 보여요</span>";
    capOcrBtn.hidden = true;
    capFile.value = "";
    capStatus.hidden = false;
    capStatus.textContent = `✅ ${added}건 추가 완료! '내역'·'차트'에서 확인하세요.`;

    await loadData(); // 현재 월 갱신
    switchView("list");
  }
}

// ════════ 이벤트 연결 ════════
function wireEvents() {
  $("btnAdd").addEventListener("click", addEntry);
  $("btnBudget").addEventListener("click", saveBudget);
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
  $("calGrid").addEventListener("click", (e) => {
    const cell = e.target.closest("[data-day]");
    if (cell) renderCalendar(Number(cell.dataset.day));
  });

  setupCapture();
}

// ════════ 시작 ════════
fillCategorySelects();
wireEvents();
buildMonthTabs();
setTodayDate();
await loadData();

// PWA: 서비스워커 등록 (폰 홈화면 설치 + 오프라인 캐시)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW 등록 실패", e));
}
