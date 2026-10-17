// capture.js — 캡쳐 OCR 흐름을 담당합니다.
// setupCapture(deps) 한 번 호출로 이벤트를 연결하고, capItems를 내부에서 관리합니다.
// 캡쳐는 여러 장을 한 번에 골라 차례로 읽고, 결과를 하나의 확인 목록으로 합칩니다(capmerge.js).
// 사진에서 못 읽은 거래는 확인 목록에서 바로 직접 추가해, 인식한 내역과 함께 저장할 수 있습니다.

import { createReader } from "./ocr.js";
import { parseTransactions } from "./parse.js";
import { mergeCaptures } from "./capmerge.js";
import { CATS } from "./categorize.js";
import { $, fmt, esc, showLoading, showToast } from "./dom.js";
import { makeEntryDate } from "./datefmt.js";
import { newEntriesOnly } from "./entryops.js";
import { genId } from "./id.js";

// 한 번에 고를 수 있는 최대 장수 (장당 몇 초씩 걸려, 너무 많으면 기다리기 힘듦)
const MAX_FILES = 20;
const OCR_ERROR_MSG = "⚠️ 인식 중 오류가 났어요. 콘솔(F12)을 확인하세요.";
// 확인 목록에서 사용자가 고칠 수 있는 값 (사진을 더 고른 뒤 다시 합쳐도 고친 값은 유지)
const EDITABLE = ["desc", "category", "amount", "dateISO"];

/**
 * 캡쳐 UI의 이벤트를 연결합니다.
 * @param {{
 *   smartCategory: (merchant: string) => string,
 *   rememberRule: (merchant: string, category: string) => Promise<void>,
 *   getUser: () => object|null,
 *   loadMonth: ((year: number, month: number) => Promise)|null,
 *   appendEntries: ((year: number, month: number, entries: object[]) => Promise)|null,
 *   showMonth: (year: number, month: number) => Promise<void>,
 *   switchView: (view: string) => void,
 *   getYear: () => number,
 *   getMonth: () => number,
 * }} deps
 */
export function setupCapture({ smartCategory, rememberRule, getUser, loadMonth, appendEntries, showMonth, switchView, getYear, getMonth }) {
  const capFile = $("capFile");
  const capPreview = $("capPreview");
  const capOcrBtn = $("capOcrBtn");
  const capStatus = $("capStatus");
  const capRaw = $("capRaw");
  const capEditor = $("capEditor");
  const capCard = capPreview.closest(".capture-card");
  // 고른 캡쳐들: { id, file, url(미리보기용 objectURL), text(읽은 원문 — 다시 읽지 않도록 기억), failed(읽기 실패) }
  let selected = [];
  // 확인 목록: { key, desc, category, amount, dateISO, time, src, edited: {고친 필드: true}, manual?, invalid? }
  //   key = 인식 항목은 "사진id:장 안 순번"(다시 합쳐도 같은 항목을 알아보는 열쇠), 직접 추가는 "m순번"
  //   src = 몇 번째 캡쳐에서 나왔는지(직접 추가는 "manual") — 목록을 장별로 묶어 보여줄 때 사용
  let capItems = [];
  const deletedKeys = new Set(); // 사용자가 지운 인식 항목 (다시 합쳐도 되살리지 않음)
  let hasResult = false; // 확인 목록을 보여주는 중인지 (이때 사진을 바꾸면 바로 다시 합침)
  let busy = false; // 인식·저장 중에는 사진·목록을 바꾸지 못하게
  let seq = 0; // id 발급용

  // 고르면 기존 목록 뒤에 덧붙임 (빠뜨린 장을 나중에 더 고를 수 있게)
  capFile.addEventListener("change", () => {
    const files = [...capFile.files];
    capFile.value = ""; // 뺐던 사진을 다시 골라도 change가 일어나도록 비움
    if (busy || files.length === 0) return;
    let overflow = false;
    let dup = 0;
    for (const file of files) {
      if (selected.length >= MAX_FILES) {
        overflow = true;
        break;
      }
      if (selected.some((s) => sameFile(s.file, file))) {
        dup++; // 같은 사진을 또 고른 경우
        continue;
      }
      selected.push({ id: ++seq, file, url: URL.createObjectURL(file), text: null, failed: false });
    }
    if (overflow) showToast(`한 번에 ${MAX_FILES}장까지 올릴 수 있어요.`, "error");
    else if (dup > 0) showToast(`이미 고른 사진 ${dup}장은 건너뛰었어요.`);
    onSelectionChange();
  });

  // 미리보기의 ✕: 그 장만 빼기
  capPreview.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".cap-thumb-del");
    if (!btn || busy) return;
    const [removed] = selected.splice(Number(btn.closest(".cap-thumb").dataset.i), 1);
    if (removed) URL.revokeObjectURL(removed.url);
    onSelectionChange();
  });

  capOcrBtn.addEventListener("click", () => readAndMerge(true));

  // 고른 사진이 바뀌면: 확인 목록을 보고 있던 중이면 바로 다시 합치고(새 사진만 읽음), 아니면 미리보기만 갱신
  function onSelectionChange() {
    renderPreview();
    if (hasResult) readAndMerge(false);
    else updateOcrBtn();
  }

  // 아직 안 읽은 장을 읽고, 전체를 다시 합쳐 확인 목록을 그립니다.
  // retryFailed: 읽기에 실패했던 장도 다시 시도할지 (버튼을 눌렀을 때만 — 사진을 바꿀 때마다 재시도하면 느려짐)
  async function readAndMerge(retryFailed) {
    if (busy) return;
    const pages = selected.slice();
    const toRead = pages.filter((p) => p.text == null && (retryFailed || !p.failed));
    setBusy(true);
    capStatus.hidden = false;
    let reader = null;
    try {
      for (const page of toRead) {
        if (!reader) {
          capStatus.textContent = "글자 인식 준비 중... (처음엔 한글 데이터 받느라 조금 걸려요)";
          reader = await createReader(); // 여기서 실패하면 어느 장도 못 읽으니 아래 catch로
        }
        // 여러 장이면 "2/5장 · "처럼 몇 번째 장인지 함께 보여줌
        const label = pages.length > 1 ? `${pages.indexOf(page) + 1}/${pages.length}장 · ` : "";
        try {
          page.text = await readCapture(reader, page.file, label);
          page.failed = false;
        } catch (err) {
          console.error(err); // 이 장만 건너뛰고 나머지는 계속 읽음
          page.failed = true;
        }
      }
      showResult(pages);
    } catch (err) {
      console.error(err);
      capStatus.textContent = OCR_ERROR_MSG;
    } finally {
      if (reader) reader.terminate().catch(() => {});
      setBusy(false);
      updateOcrBtn();
    }
  }

  // 한 장을 읽습니다. 보정본에서 한 건도 못 찾으면, 보정이 오히려 망친 경우일 수 있어 원본으로 한 번 더
  async function readCapture(reader, file, label) {
    const text = await reader.read(file, (pct) => (capStatus.textContent = `글자 인식 중... ${label}${pct}%`));
    if (parseTransactions(text).expenses.length > 0) return text;
    capStatus.textContent = `다시 인식 중... ${label}(원본 그대로)`;
    try {
      const rawTry = await reader.read(file, (pct) => (capStatus.textContent = `다시 인식 중... ${label}${pct}%`), { preprocess: false });
      return parseTransactions(rawTry).expenses.length > 0 ? rawTry : text;
    } catch (err) {
      console.warn("원본 재인식 실패 — 보정본 결과 사용", err);
      return text;
    }
  }

  // 읽은 장들을 합쳐 상태 문구·원문·확인 목록을 그립니다.
  function showResult(pages) {
    const texts = pages.map((p) => p.text);
    const { expenses, excludedIncome, overlapped } = mergeCaptures(texts);
    rebuildItems(pages, expenses);
    if (pages.length === 0 && capItems.length === 0) {
      resetResult(); // 사진도, 직접 추가한 내역도 없음 → 처음 상태로
      return;
    }
    hasResult = true;

    const read = texts.filter((t) => t != null).length;
    const failedNos = pages.flatMap((p, i) => (p.text == null ? [i + 1] : []));
    const parts = [];
    if (read > 0 && expenses.length === 0) {
      parts.push("지출을 찾지 못했어요. 다른 캡쳐를 올리거나 아래에서 직접 추가하세요.");
    } else if (read > 0) {
      const skipped = [];
      if (overlapped > 0) skipped.push(`겹친 ${overlapped}건`);
      if (excludedIncome > 0) skipped.push(`수입 ${excludedIncome}건`);
      parts.push(
        (pages.length > 1 ? `${pages.length}장에서 ` : "") +
        `지출 ${expenses.length}건 인식${skipped.length ? ` (${skipped.join(" · ")} 제외)` : ""}. ` +
        "확인·수정 후 '전체 추가'를 누르세요. 빠진 내역은 아래에서 직접 추가할 수 있어요."
      );
    }
    if (failedNos.length) parts.push(`⚠️ ${failedNos.join(", ")}번 캡쳐는 읽지 못했어요.`);
    capStatus.textContent = parts.join(" ");
    capStatus.hidden = parts.length === 0;

    if (read > 0) showCapRaw(texts);
    else capRaw.hidden = true;
    renderCapEditor();
  }

  // 합친 인식 결과로 확인 목록을 다시 만듭니다. 사용자가 고친 값·지운 항목·직접 추가한 내역은 그대로 유지.
  function rebuildItems(pages, expenses) {
    const prev = new Map(capItems.map((it) => [it.key, it]));
    const recognized = [];
    for (const e of expenses) {
      const key = `${pages[e.src].id}:${e.idx}`;
      if (deletedKeys.has(key)) continue;
      const it = { key, desc: e.merchant, amount: e.amount, dateISO: e.date, time: e.time, src: e.src, edited: {} };
      const old = prev.get(key);
      if (old) {
        it.edited = old.edited;
        for (const f of EDITABLE) if (old.edited[f]) it[f] = old[f];
      }
      // 분류를 직접 고르지 않았으면 (고친) 이름으로 자동 분류
      if (!it.edited.category) it.category = smartCategory(it.desc);
      recognized.push(it);
    }
    capItems = [...recognized, ...capItems.filter((it) => it.manual)];
  }

  function resetResult() {
    capItems = [];
    deletedKeys.clear();
    hasResult = false;
    capEditor.hidden = true;
    capStatus.hidden = true;
    capRaw.hidden = true;
  }

  function setBusy(on) {
    busy = on;
    capFile.disabled = on;
    capOcrBtn.disabled = on;
    capCard.classList.toggle("busy", on);
  }

  // 읽을 장이 남았을 때만 버튼을 보여줌 (결과를 본 뒤엔 실패한 장 다시 읽기용)
  function updateOcrBtn() {
    const unread = selected.filter((s) => s.text == null).length;
    capOcrBtn.hidden = unread === 0;
    capOcrBtn.textContent = !hasResult
      ? (selected.length > 1 ? `🔍 ${selected.length}장 글자 읽기 (OCR)` : "🔍 글자 읽기 (OCR)")
      : `🔁 못 읽은 ${unread}장 다시 읽기`;
  }

  function renderPreview() {
    if (selected.length === 0) {
      capPreview.classList.add("empty");
      capPreview.innerHTML = "<span>고른 캡쳐가 여기 보여요</span>";
      return;
    }
    capPreview.classList.remove("empty");
    capPreview.innerHTML = selected
      .map((s, i) => `
        <div class="cap-thumb" data-i="${i}">
          <img src="${s.url}" alt="캡쳐 ${i + 1}" />
          ${selected.length > 1 ? `<span class="cap-thumb-no">${i + 1}</span>` : ""}
          <button class="cap-thumb-del" title="빼기" aria-label="${i + 1}번 캡쳐 빼기">✕</button>
        </div>`)
      .join("");
  }

  // ── 확인 목록 (이벤트 위임) ──
  const itemOf = (el) => {
    const row = el.closest(".cap-row");
    return row ? capItems[Number(row.dataset.i)] : null;
  };
  // 값을 고치면 고쳤다고 표시하고(다시 합쳐도 유지), 빈칸 경고는 지움
  const edit = (el, it, field, value) => {
    it[field] = value;
    it.edited[field] = true;
    it.invalid = false;
    el.closest(".cap-row").classList.remove("invalid");
  };

  capEditor.addEventListener("input", (ev) => {
    const it = itemOf(ev.target);
    if (!it) return;
    const cls = ev.target.classList;
    if (cls.contains("cap-desc")) edit(ev.target, it, "desc", ev.target.value);
    else if (cls.contains("cap-date")) edit(ev.target, it, "dateISO", ev.target.value);
    else if (cls.contains("cap-amt")) {
      edit(ev.target, it, "amount", parseInt(ev.target.value) || 0);
      updateCapTotal();
    }
  });
  capEditor.addEventListener("change", (ev) => {
    const it = itemOf(ev.target);
    if (!it) return;
    const cls = ev.target.classList;
    if (cls.contains("cap-cat")) {
      edit(ev.target, it, "category", ev.target.value);
      rememberRule(it.desc, ev.target.value); // 고친 분류를 학습
    } else if (cls.contains("cap-date")) {
      edit(ev.target, it, "dateISO", ev.target.value);
    } else if (cls.contains("cap-desc") && !it.edited.category) {
      // 분류를 직접 고른 적이 없으면, 고친 이름으로 다시 자동 분류 (잘못 읽힌 이름을 고친 경우)
      it.category = smartCategory(it.desc);
      ev.target.closest(".cap-row").querySelector(".cap-cat").value = it.category;
    }
  });
  capEditor.addEventListener("click", (ev) => {
    if (busy) return;
    if (ev.target.closest(".cap-del")) {
      const [removed] = capItems.splice(Number(ev.target.closest(".cap-row").dataset.i), 1);
      if (removed && !removed.manual) deletedKeys.add(removed.key);
      renderCapEditor();
    } else if (ev.target.closest("#capAddRow")) {
      addManualRow();
    } else if (ev.target.closest("#capImport")) {
      importCaptured();
    }
  });

  function renderCapEditor() {
    const addBtn = `<button class="cap-add-btn" id="capAddRow">✍️ 빠진 내역 직접 추가</button>`;
    if (capItems.length === 0) {
      capEditor.innerHTML = `<div class="empty">확인할 지출이 없어요. 사진에서 못 읽은 내역은 직접 추가할 수 있어요.</div>${addBtn}`;
      capEditor.hidden = false;
      return;
    }
    // 여러 장(또는 직접 추가)에서 나왔으면 묶어 보여줌 (어느 캡쳐에서 읽었는지, 날짜가 맞는지 대조하기 쉽게)
    const grouped = capItems.some((it) => it.src !== capItems[0].src);
    const rows = capItems
      .map((it, i) => (grouped && (i === 0 || it.src !== capItems[i - 1].src) ? groupHeader(it.src) : "") + rowHTML(it, i))
      .join("");
    capEditor.innerHTML =
      rows +
      addBtn +
      `<div class="cap-import-row"><span class="total">합계 <b>${fmt(capTotal())}</b> · ${capItems.length}건</span><button class="btn-add cap-import-btn" id="capImport">전체 추가</button></div>`;
    capEditor.hidden = false;
  }

  function rowHTML(it, i) {
    return `
        <div class="cap-row${it.invalid ? " invalid" : ""}" data-i="${i}">
          <div class="cap-line">
            <input class="cap-desc" value="${esc(it.desc)}" placeholder="내용 (가맹점)" />
            <input class="cap-amt" type="number" inputmode="numeric" value="${it.amount || ""}" placeholder="금액" />
          </div>
          <div class="cap-line">
            <input class="cap-date" type="date" value="${esc(it.dateISO)}" aria-label="날짜" />
            <select class="cap-cat" aria-label="카테고리">${CATS.map((c) => `<option ${c === it.category ? "selected" : ""}>${c}</option>`).join("")}</select>
            <button class="cap-del" title="삭제" aria-label="삭제">🗑</button>
          </div>
        </div>`;
  }

  // 묶음 머리글: "📷 2번 캡쳐 · 6/12~6/14 · 8건", "✍️ 직접 추가 · 1건"
  function groupHeader(src) {
    const items = capItems.filter((it) => it.src === src);
    const label = src === "manual" ? "✍️ 직접 추가" : `📷 ${src + 1}번 캡쳐`;
    const days = items.map((it) => it.dateISO).filter(isValidISO).sort();
    let range = "";
    if (days.length) {
      const from = shortDate(days[0]);
      const to = shortDate(days[days.length - 1]);
      range = ` · ${from === to ? from : `${from}~${to}`}`;
    }
    return `<div class="cap-group">${label}${range} · ${items.length}건</div>`;
  }

  // 사진에서 못 읽은 거래를 직접 넣는 빈 줄 추가. 날짜는 바로 위 줄을 따름(같은 날 거래를 연달아 넣기 쉽게)
  function addManualRow() {
    const last = capItems[capItems.length - 1];
    capItems.push({
      key: `m${++seq}`,
      manual: true,
      src: "manual",
      desc: "",
      category: "기타",
      amount: 0,
      dateISO: last && isValidISO(last.dateISO) ? last.dateISO : todayISO(),
      time: null,
      edited: {},
    });
    hasResult = true;
    renderCapEditor();
    const rows = capEditor.querySelectorAll(".cap-row");
    const input = rows[rows.length - 1].querySelector(".cap-desc");
    input.focus();
    input.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // 인식이 이상할 때 원인을 볼 수 있게, OCR이 읽은 원문을 접이식으로 보여줍니다. (여러 장이면 장별로 구분)
  function showCapRaw(texts) {
    const body =
      texts.length === 1
        ? esc(texts[0].trim())
        : texts.map((t, i) => `── ${i + 1}번 캡쳐 ──\n${t == null ? "(읽지 못함)" : esc(t.trim())}`).join("\n\n");
    capRaw.innerHTML = `<details class="cap-raw"><summary>🔎 인식 원문 보기 (잘못 읽었다면 여기서 확인)</summary><pre>${body}</pre></details>`;
    capRaw.hidden = false;
  }

  function capTotal() {
    return capItems.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  }
  function updateCapTotal() {
    const el = capEditor.querySelector(".total b");
    if (el) el.textContent = fmt(capTotal());
  }

  async function importCaptured() {
    if (busy) return; // 저장 중 다시 누름(더블 탭) → 같은 내역이 두 번 저장되지 않게
    // 저장할 줄 고르기. 금액을 지운 인식 항목·통째로 빈 직접 추가 줄은 '지운 칸'으로 보고 건너뛰고,
    // 그 밖에 내용·금액·날짜 중 빈 게 있으면 표시해서 채우게 함 (수동 추가와 같은 기준)
    const rows = [];
    let invalid = 0;
    for (const it of capItems) {
      const amount = Number(it.amount) || 0;
      const desc = String(it.desc ?? "").trim();
      it.invalid = false;
      if (amount <= 0 && (!it.manual || !desc)) continue;
      if (!desc || amount <= 0 || !isValidISO(it.dateISO)) {
        it.invalid = true;
        invalid++;
        continue;
      }
      rows.push({ ...it, desc, amount });
    }
    if (invalid > 0) {
      renderCapEditor();
      capEditor.querySelector(".cap-row.invalid").scrollIntoView({ block: "center", behavior: "smooth" });
      showToast(`내용·금액·날짜가 빈 ${invalid}건을 채우거나 지워주세요.`, "error");
      return;
    }
    if (rows.length === 0) {
      showToast("추가할 내역이 없어요.", "error");
      return;
    }
    if (!getUser()) {
      showToast("아직 연결 중이에요. 잠시 후 다시 시도하세요.", "error");
      return;
    }
    setBusy(true);
    showLoading(true);
    // 각 항목을 날짜가 속한 '월'로 묶어서 그 월 문서에 추가
    const groups = new Map();
    for (const it of rows) {
      const [y, mo, d] = it.dateISO.split("-").map(Number);
      const key = `${y}_${mo - 1}`;
      if (!groups.has(key)) groups.set(key, { year: y, month: mo - 1, entries: [] });
      groups.get(key).entries.push({
        category: it.category,
        desc: it.desc,
        amount: it.amount,
        date: makeEntryDate(mo - 1, d, it.time || "00:00"),
        id: genId(), // 고유 id: 같은 분·같은 금액 두 건(커피 두 잔)도 arrayUnion이 하나로 합치지 않게
      });
    }
    let added = 0;
    let skipped = 0;
    const addedMonths = [];
    try {
      for (const g of groups.values()) {
        const data = await loadMonth(g.year, g.month);
        // 이미 저장된 거래는 건너뜀 (같은 캡쳐를 다시 올렸거나, 지난번 저장이 중간에 끊긴 경우)
        const { toAdd, skipped: dup } = newEntriesOnly(data.entries || [], g.entries);
        skipped += dup;
        if (toAdd.length) {
          // 원자적 추가: 다른 가족이 동시에 넣은 내역을 덮어쓰지 않음
          await appendEntries(g.year, g.month, toAdd);
          added += toAdd.length;
          addedMonths.push({ year: g.year, month: g.month, count: toAdd.length });
        }
      }
    } catch (e) {
      console.error(e);
      showToast(
        added > 0
          ? `일부(${added}건)만 저장됐어요. '전체 추가'를 다시 누르면 나머지만 저장돼요.`
          : "저장 오류. 인터넷 연결을 확인해주세요.",
        "error"
      );
      return;
    } finally {
      showLoading(false);
      setBusy(false);
    }

    // 캡쳐 화면 정리
    for (const s of selected) URL.revokeObjectURL(s.url);
    selected = [];
    resetResult();
    renderPreview();
    updateOcrBtn();

    const months = addedMonths.map((g) => `${g.year !== getYear() ? `${g.year}년 ` : ""}${g.month + 1}월 ${g.count}건`);
    const msg =
      added > 0
        ? `✅ ${added}건 추가 완료!${months.length > 1 ? ` (${months.join(" · ")})` : ""}${skipped > 0 ? ` 중복 ${skipped}건은 건너뛰었어요.` : ""}`
        : `이미 다 추가된 내역이에요 (중복 ${skipped}건 건너뜀).`;
    capStatus.hidden = false;
    capStatus.textContent = msg;
    showToast(msg);
    if (added === 0) return;
    // 보고 있는 달에 추가된 게 없으면, 가장 많이 추가된 달로 옮겨 보여줌
    const target =
      addedMonths.find((g) => g.year === getYear() && g.month === getMonth()) ||
      addedMonths.reduce((a, b) => (b.count > a.count ? b : a));
    await showMonth(target.year, target.month);
    switchView("list");
  }
}

// 같은 파일을 또 골랐는지 (File 객체는 고를 때마다 새로 만들어져 ===로는 비교할 수 없음)
function sameFile(a, b) {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

// "YYYY-MM-DD" 형식의, 달력에 실제로 있는 날짜인지
function isValidISO(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function todayISO() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

// "2026-06-12" → "6/12"
function shortDate(iso) {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}
