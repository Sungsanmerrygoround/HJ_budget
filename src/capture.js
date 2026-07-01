// capture.js — 캡쳐 OCR 흐름을 담당합니다.
// setupCapture(deps) 한 번 호출로 이벤트를 연결하고, capItems를 내부에서 관리합니다.

import { extractText } from "./ocr.js";
import { parseTransactions } from "./parse.js";
import { CATS } from "./categorize.js";
import { $, fmt, esc, showLoading, showToast } from "./dom.js";
import { makeEntryDate } from "./datefmt.js";
import { entryKey } from "./entryops.js";

/**
 * 캡쳐 UI의 이벤트를 연결합니다.
 * @param {{
 *   smartCategory: (merchant: string) => string,
 *   rememberRule: (merchant: string, category: string) => Promise<void>,
 *   getUser: () => object|null,
 *   loadMonth: ((year: number, month: number) => Promise)|null,
 *   appendEntries: ((year: number, month: number, entries: object[]) => Promise)|null,
 *   loadData: () => Promise<void>,
 *   switchView: (view: string) => void,
 *   getYear: () => number,
 *   getMonth: () => number,
 * }} deps
 */
export function setupCapture({ smartCategory, rememberRule, getUser, loadMonth, appendEntries, loadData, switchView, getYear, getMonth }) {
  const capFile = $("capFile");
  const capPreview = $("capPreview");
  const capOcrBtn = $("capOcrBtn");
  const capStatus = $("capStatus");
  const capEditor = $("capEditor");
  let selectedFile = null;
  let capItems = []; // 캡쳐로 인식한 임시 항목들 (이 모듈 안에서만 관리)

  capFile.addEventListener("change", () => {
    const file = capFile.files[0];
    if (!file) return;
    selectedFile = file;
    capPreview.classList.remove("empty");
    capPreview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="캡쳐 미리보기" />`;
    capOcrBtn.hidden = false;
    capEditor.hidden = true;
    capStatus.hidden = true;
    $("capRaw").hidden = true;
  });

  capOcrBtn.addEventListener("click", async () => {
    if (!selectedFile) return;
    capOcrBtn.disabled = true;
    capStatus.hidden = false;
    capStatus.textContent = "글자 인식 준비 중... (처음엔 한글 데이터 받느라 조금 걸려요)";
    try {
      let text = await extractText(selectedFile, (pct) => (capStatus.textContent = `글자 인식 중... ${pct}%`));
      let parsed = parseTransactions(text);
      // 보정본에서 한 건도 못 찾으면, 보정이 오히려 망친 경우일 수 있어 원본으로 한 번 더
      if (parsed.expenses.length === 0) {
        capStatus.textContent = "다시 인식 중... (원본 그대로)";
        const rawTry = await extractText(selectedFile, (pct) => (capStatus.textContent = `다시 인식 중... ${pct}%`), { preprocess: false });
        const rawParsed = parseTransactions(rawTry);
        if (rawParsed.expenses.length > 0) {
          text = rawTry;
          parsed = rawParsed;
        }
      }
      const { expenses, excludedIncome } = parsed;
      showCapRaw(text);
      capItems = expenses.map((e) => ({
        desc: e.merchant,
        category: smartCategory(e.merchant),
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

  // 인식이 이상할 때 원인을 볼 수 있게, OCR이 읽은 원문을 접이식으로 보여줍니다.
  function showCapRaw(text) {
    const el = $("capRaw");
    if (!el) return;
    el.innerHTML = `<details class="cap-raw"><summary>🔎 인식 원문 보기 (잘못 읽었다면 여기서 확인)</summary><pre>${esc(text.trim())}</pre></details>`;
    el.hidden = false;
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
    if (!getUser()) {
      showToast("아직 연결 중이에요. 잠시 후 다시 시도하세요.", "error");
      return;
    }
    showLoading(true);
    // 각 항목을 날짜가 속한 '월'로 묶어서 그 월 문서에 추가
    const groups = {};
    for (const it of capItems) {
      // 금액이 0 이하인 항목은 건너뜀(수동 추가와 동일 기준 — 사용자가 지운 칸 등)
      const amount = Number(it.amount) || 0;
      if (amount <= 0) continue;
      const d = new Date((it.dateISO || "") + "T00:00:00");
      const valid = !isNaN(d.getTime());
      const y = valid ? d.getFullYear() : getYear();
      const m = valid ? d.getMonth() : getMonth();
      const day = valid ? d.getDate() : new Date().getDate();
      const key = `${y}_${m}`;
      if (!groups[key]) groups[key] = { year: y, month: m, entries: [] };
      groups[key].entries.push({
        category: it.category,
        desc: it.desc,
        amount,
        date: makeEntryDate(m, day, it.time || "00:00"),
      });
    }
    // 중복 판별 키: 날짜 + 가맹점 + 금액 (entryops와 동일 규칙)
    let added = 0;
    let skipped = 0;
    try {
      for (const key in groups) {
        const g = groups[key];
        const data = await loadMonth(g.year, g.month);
        const existing = data.entries || [];
        const seen = new Set(existing.map(entryKey)); // 이미 저장된 항목들
        const toAdd = [];
        for (const e of g.entries) {
          const k = entryKey(e);
          if (seen.has(k)) {
            skipped++; // 이미 있는 거래 → 건너뜀
            continue;
          }
          seen.add(k); // 같은 캡쳐 안의 중복도 방지
          toAdd.push(e);
        }
        if (toAdd.length) {
          // 원자적 추가: 다른 가족이 동시에 넣은 내역을 덮어쓰지 않음
          await appendEntries(g.year, g.month, toAdd);
          added += toAdd.length;
        }
      }
    } catch (e) {
      console.error(e);
      showLoading(false);
      showToast("저장 오류. 인터넷 연결을 확인해주세요.", "error");
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
    $("capRaw").hidden = true;
    capStatus.hidden = false;
    capStatus.textContent =
      added > 0
        ? `✅ ${added}건 추가 완료!${skipped > 0 ? ` (중복 ${skipped}건 건너뜀)` : ""} '내역'·'차트'에서 확인하세요.`
        : `이미 다 추가된 내역이에요 (중복 ${skipped}건 건너뜀).`;

    await loadData(); // 현재 월 갱신
    if (added > 0) switchView("list");
  }
}
