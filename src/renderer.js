// renderer.js — 데이터를 받아 DOM에 그리는 순수 렌더 함수들.
// 앱 상태(cachedEntries 등)를 직접 보지 않고 인자로 받아 동작합니다.
// chartInstance만 여기서 관리합니다(Chart.js 인스턴스는 캔버스와 1:1).

import { CATS, CAT_ICONS, CAT_COLORS } from "./categorize.js";
import { $, fmt, fmtShort, esc } from "./dom.js";
import { sumAmount, categoryTotals, rankedCategories } from "./aggregate.js";

let chartInstance = null;

// 요일별 지출 미니 바차트 (히어로 카드 안)
export function renderWeekBars(entries, year, month) {
  const el = $("weekBars");
  if (!el) return;
  const DOW = ["월", "화", "수", "목", "금", "토", "일"];
  const totals = [0, 0, 0, 0, 0, 0, 0];
  entries.forEach((e) => {
    const day = parseInt((e.date.split(" ")[0] || "").split("/")[1]);
    if (!day || isNaN(day)) return;
    const dow = new Date(year, month, day).getDay(); // 0=일
    totals[(dow + 6) % 7] += e.amount; // 월요일 시작으로 변환
  });
  const max = Math.max(...totals, 1);
  const t = new Date();
  const isRealMonth = year === t.getFullYear() && month === t.getMonth();
  const todayIdx = isRealMonth ? (t.getDay() + 6) % 7 : -1;
  el.innerHTML = totals
    .map((v, i) => `
      <div class="week-d ${i === todayIdx ? "on" : ""}" title="${fmt(v)}">
        <div class="week-bar" style="height:${Math.max(Math.round((v / max) * 30), 4)}px"></div>
        <span>${DOW[i]}</span>
      </div>`)
    .join("");
}

// 카테고리 TOP4 칩 (탭하면 해당 카테고리 상세)
export function renderCatChips(entries) {
  const el = $("catChips");
  if (!el) return;
  const expense = sumAmount(entries);
  const rows = rankedCategories(entries).slice(0, 4);
  if (rows.length === 0) { el.innerHTML = ""; return; }
  el.innerHTML = rows
    .map(({ cat, total, i }, di) => `
      <div class="cat-chip glass" data-cat="${cat}" style="animation:fadeSlideIn 0.28s cubic-bezier(.4,0,.2,1) both;animation-delay:${di * 0.06}s">
        <div class="cc-icon" style="background:${CAT_COLORS[i]}33">${CAT_ICONS[cat] || "📦"}</div>
        <div class="cc-name">${cat}</div>
        <div class="cc-amt">${fmtShort(total)}</div>
        <div class="cc-pct" style="color:${CAT_COLORS[i]}">${Math.round((total / expense) * 100)}%</div>
      </div>`)
    .join("");
}

export function renderChart(entries) {
  const totals = categoryTotals(entries);
  const hasData = totals.some((t) => t > 0);
  const ctx = $("myChart").getContext("2d");
  if (chartInstance) chartInstance.destroy();
  if (!hasData) {
    chartInstance = null;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.font = "500 13px Outfit, Noto Sans KR, sans-serif";
    ctx.fillStyle = "#A9A2C2";
    ctx.textAlign = "center";
    ctx.fillText("이번 달은 아직 깨끗해요 ✨", ctx.canvas.width / 2, 100);
    return;
  }
  const filtered = CATS.map((c, i) => ({ label: c, value: totals[i], color: CAT_COLORS[i] })).filter((d) => d.value > 0);
  chartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: filtered.map((d) => d.label),
      datasets: [{
        data: filtered.map((d) => d.value),
        backgroundColor: filtered.map((d) => d.color + "1A"),
        borderColor: filtered.map((d) => d.color),
        borderWidth: 2.5,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "right",
          labels: { font: { size: 11, family: "Outfit, Noto Sans KR, sans-serif", weight: "500" }, color: "#7A7396", padding: 10, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "circle" },
        },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.parsed.toLocaleString("ko-KR")}원` } },
      },
    },
  });
}

export function renderCatList(entries) {
  const maxTotal = Math.max(...categoryTotals(entries), 1);
  const container = $("catList");
  const rows = rankedCategories(entries);
  if (rows.length === 0) {
    container.innerHTML = '<div class="empty">이번 달은 아직 깨끗해요 ✨</div>';
    return;
  }
  container.innerHTML = rows
    .map(({ cat, total, i }, di) => `
      <div class="cat-item" data-cat="${cat}" style="animation:fadeSlideIn 0.28s cubic-bezier(.4,0,.2,1) both;animation-delay:${di * 0.06}s">
        <div class="cat-header"><div class="cat-name">${CAT_ICONS[cat] || "📦"} ${cat}</div><div class="cat-total">${fmt(total)}</div></div>
        <div class="cat-bar-bg"><div class="cat-bar" style="width:${Math.round((total / maxTotal) * 100)}%;background:${CAT_COLORS[i]}"></div></div>
      </div>`)
    .join("");
}

export function renderEntryList(entries, emptyMsg = "아직 기록이 없어요 💙<br>오늘 첫 소비를 담아볼까요?") {
  const container = $("entryList");
  if (entries.length === 0) {
    container.innerHTML = `<div class="empty">${emptyMsg}</div>`;
    return;
  }
  container.innerHTML = [...entries]
    .reverse()
    .map((e, di) => `
      <div class="entry-item" data-index="${"_origIdx" in e ? e._origIdx : entries.indexOf(e)}" style="animation:fadeSlideIn 0.28s cubic-bezier(.4,0,.2,1) both;animation-delay:${Math.min(di * 0.04, 0.32)}s">
        <div><div class="entry-desc">${esc(e.desc)} <span style="font-size:11px;color:var(--sub2)">[${esc(e.category)}]</span></div><div class="entry-meta">${esc(e.date)} · 탭해서 수정</div></div>
        <div class="entry-amt-expense">-${fmt(e.amount)}</div>
      </div>`)
    .join("");
}

let trendChartInstance = null;

export function renderMonthlyTrend(months) {
  const canvas = $("trendChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (trendChartInstance) trendChartInstance.destroy();
  trendChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: months.map((m) => m.label),
      datasets: [{
        data: months.map((m) => m.total),
        backgroundColor: months.map((_, i) =>
          i === months.length - 1 ? "rgba(37,99,235,0.85)" : "rgba(37,99,235,0.22)"),
        borderColor: months.map((_, i) =>
          i === months.length - 1 ? "#2563EB" : "rgba(37,99,235,0.35)"),
        borderWidth: 1.5,
        borderRadius: 8,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (c) => ` ${c.parsed.y.toLocaleString("ko-KR")}원` },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11, family: "Outfit, Noto Sans KR, sans-serif" }, color: "#94A3B8" },
        },
        y: {
          grid: { color: "rgba(0,0,0,0.04)" },
          ticks: {
            font: { size: 10, family: "Outfit, Noto Sans KR, sans-serif" },
            color: "#94A3B8",
            callback: (v) => v >= 10000 ? (v / 10000).toFixed(0) + "만" : v,
          },
        },
      },
    },
  });
}

// entries, year, month 를 인자로 받아 달력을 그립니다. selectedDay는 선택 사항.
export function renderCalendar(entries, year, month, selectedDay) {
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
    const total = sumAmount(dayEntries);
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
    const hasData = dayEntries.length > 0;
    html += `<div class="cal-cell ${hasData ? "has-data" : ""} ${isToday ? "today" : ""} ${selectedDay === d ? "selected-day" : ""}" ${hasData ? `data-day="${d}"` : ""}>
      <div class="cal-day">${d}</div>${total > 0 ? `<div class="cal-amt">${(total / 10000).toFixed(1)}만</div>` : ""}</div>`;
  }
  grid.innerHTML = html;
  if (selectedDay) {
    const dayStr = `${month + 1}/${selectedDay}`;
    const dayEntries = dayMap[dayStr] || [];
    const total = sumAmount(dayEntries);
    $("dayDetailTitle").textContent = `${month + 1}월 ${selectedDay}일 · ${fmt(total)}`;
    $("dayEntryList").innerHTML = dayEntries
      .map((e) => `
        <div class="entry-item" data-index="${entries.indexOf(e)}">
          <div><div class="entry-desc">${esc(e.desc)} <span style="font-size:11px;color:var(--sub2)">[${esc(e.category)}]</span></div><div class="entry-meta">${esc(e.date)} · 탭해서 수정</div></div>
          <div class="entry-amt-expense">-${fmt(e.amount)}</div>
        </div>`)
      .join("");
    $("dayDetail").style.display = "block";
  } else {
    $("dayDetail").style.display = "none";
  }
}
