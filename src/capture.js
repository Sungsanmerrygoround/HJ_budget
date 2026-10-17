// capture.js — 캡쳐 OCR 흐름을 담당합니다.
// setupCapture(deps) 한 번 호출로 이벤트를 연결하고, capItems를 내부에서 관리합니다.
// 캡쳐는 여러 장을 한 번에 골라 차례로 읽고, 결과를 하나의 확인 목록으로 합칩니다(capmerge.js).
// 사진에서 못 읽은 거래는 확인 목록에서 바로 직접 추가해, 인식한 내역과 함께 저장할 수 있습니다.

import { createReader, makeThumbnail } from "./ocr.js";
import { parseTransactions } from "./parse.js";
import { mergeCaptures } from "./capmerge.js";
import { CATS } from "./categorize.js";
import { $, fmt, esc, showLoading, showToast } from "./dom.js";
import { makeEntryDate, todayISO, parseISO, shortDate } from "./datefmt.js";
import { newEntriesOnly } from "./entryops.js";
import { genId } from "./id.js";

// 한 번에 고를 수 있는 최대 장수 (장당 몇 초씩 걸려, 너무 많으면 기다리기 힘듦)
const MAX_FILES = 20;
// 다 읽고 이만큼 안 쓰면 OCR 엔진을 내려 메모리를 돌려줌 (그 전에 사진을 더하면 엔진을 다시 띄우지 않고 바로 읽음)
const READER_IDLE_MS = 60000;
const OCR_ERROR_MSG = "⚠️ 인식 중 오류가 났어요. 콘솔(F12)을 확인하세요.";
const ENGINE_ERROR_MSG = "⚠️ 글자 인식 엔진을 불러오지 못했어요. 인터넷 연결을 확인하고 '다시 읽기'를 눌러주세요.";

/**
 * 캡쳐 UI의 이벤트를 연결합니다.
 * @param {{
 *   smartCategory: (merchant: string) => string,
 *   rememberRule: (merchant: string, category: string) => Promise<void>,
 *   getUser: () => object|null,
 *   loadMonth: ((year: number, month: number) => Promise)|null,
 *   appendEntries: ((year: number, month: number, entries: object[]) => Promise)|null,
 *   peekMonth: (year: number, month: number) => Promise<void>,
 *   switchView: (view: string) => void,
 *   getYear: () => number,
 *   getMonth: () => number,
 * }} deps
 */
export function setupCapture({ smartCategory, rememberRule, getUser, loadMonth, appendEntries, peekMonth, switchView, getYear, getMonth }) {
  const capFile = $("capFile");
  const capPreview = $("capPreview");
  const capOcrBtn = $("capOcrBtn");
  const capStatus = $("capStatus");
  const capRaw = $("capRaw");
  const capEditor = $("capEditor");
  const capCard = capPreview.closest(".capture-card");
  // 고른 캡쳐들: { id, key(파일 식별), file, thumb(미리보기 objectURL), text(읽은 원문),
  //               state: "new"(아직 안 읽음) | "done"(읽음) | "failed"(읽다가 실패) }
  let selected = [];
  // 파일별로 읽은 결과: 실수로 뺐다가 다시 넣어도 다시 읽지 않고, 같은 id라 고친 값·지운 줄도 그대로 돌아옴
  const readCache = new Map(); // 파일 key → { id, text }
  // 확인 목록: { keys, desc, category, amount, dateISO, time, src, edits, manual?, invalid? }
  //   keys = 인식 항목을 알아보는 열쇠들 "사진id:장 안 순번". 겹쳐 찍혀 하나로 합친 다른 장의 같은 거래 열쇠도 함께 들어 있어,
  //          사진을 더하거나 빼서 남는 쪽이 바뀌어도 같은 항목으로 알아봄
  //   edits = 사용자가 고친 값 {필드: 값} (다시 합쳐도 이 값이 인식 결과보다 우선)
  //   src = 몇 번째 캡쳐에서 나왔는지(직접 추가는 "manual") — 목록을 장별로 묶어 보여줄 때 사용
  let capItems = [];
  const edits = new Map(); // 열쇠 → 그 거래의 edits (같은 거래의 열쇠들은 같은 객체를 가리킴)
  const deletedKeys = new Set(); // 사용자가 지운 인식 항목의 열쇠 (다시 합쳐도 되살리지 않음)
  let busy = false; // 인식·저장 중에는 사진·목록을 바꾸지 못하게
  let seq = 0; // id 발급용
  // OCR 리더는 만들기가 비싸(엔진·한글 데이터 준비에 몇 초) 캡쳐 화면에 있는 동안 재사용
  let readerP = null;
  let readerTimer = 0;
  // 확인 목록을 보여주는 중인지 (이때 사진을 바꾸면 바로 다시 합침)
  const showingResult = () => !capEditor.hidden;

  // 고르면 기존 목록 뒤에 덧붙임 (빠뜨린 장을 나중에 더 고를 수 있게).
  // 사진을 알아보는 열쇠(해시)를 구하는 동안 또 고르면, 앞의 것을 다 넣은 뒤에 차례로 처리 (같은 사진이 두 번 들어가지 않게)
  let adding = Promise.resolve();
  capFile.addEventListener("change", () => {
    const files = [...capFile.files];
    capFile.value = ""; // 뺐던 사진을 다시 골라도 change가 일어나도록 비움
    if (busy || files.length === 0) return;
    adding = adding.then(() => addFiles(files)).catch((err) => console.error(err));
  });

  async function addFiles(files) {
    const keys = await Promise.all(files.map(fileKey));
    let overflow = false;
    let dup = 0;
    for (const [i, file] of files.entries()) {
      if (selected.length >= MAX_FILES) {
        overflow = true;
        break;
      }
      const key = keys[i];
      if (selected.some((s) => s.key === key)) {
        dup++; // 같은 사진을 또 고른 경우
        continue;
      }
      const cached = readCache.get(key);
      const s = cached
        ? { id: cached.id, key, file, thumb: null, text: cached.text, state: "done" }
        : { id: ++seq, key, file, thumb: null, text: null, state: "new" };
      selected.push(s);
      loadThumb(s);
    }
    if (overflow) showToast(`한 번에 ${MAX_FILES}장까지 올릴 수 있어요.`, "error");
    else if (dup > 0) showToast(`이미 고른 사진 ${dup}장은 건너뛰었어요.`);
    onSelectionChange();
  }

  // 미리보기의 ✕: 그 장만 빼기
  capPreview.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".cap-thumb-del");
    if (!btn || busy) return;
    const [removed] = selected.splice(Number(btn.closest(".cap-thumb").dataset.i), 1);
    if (removed && removed.thumb) URL.revokeObjectURL(removed.thumb);
    onSelectionChange();
  });

  capOcrBtn.addEventListener("click", () => readAndMerge(true));

  // 고른 사진이 바뀌면: 확인 목록을 보고 있던 중이면 바로 다시 합치고(새 사진만 읽음), 아니면 미리보기만 갱신
  function onSelectionChange() {
    renderPreview();
    if (showingResult()) readAndMerge(false);
    else updateOcrBtn();
  }

  // 미리보기는 작게 줄인 그림으로 (원본을 칸마다 통째로 풀면 장당 10MB 넘게 차지). 줄이지 못하면 원본으로
  async function loadThumb(s) {
    let url = null;
    try {
      url = await makeThumbnail(s.file);
    } catch (err) {
      console.warn("미리보기 만들기 실패 — 원본으로 표시", err);
    }
    if (!selected.includes(s)) {
      if (url) URL.revokeObjectURL(url); // 그사이 뺐거나 저장했으면 버림
      return;
    }
    s.thumb = url || URL.createObjectURL(s.file);
    renderPreview();
  }

  // 아직 안 읽은 장을 읽고, 전체를 다시 합쳐 확인 목록을 그립니다.
  // retryFailed: 읽기에 실패했던 장도 다시 시도할지 (버튼을 눌렀을 때만 — 사진을 바꿀 때마다 재시도하면 느려짐)
  async function readAndMerge(retryFailed) {
    if (busy) return;
    const pages = selected.slice();
    const toRead = pages.filter((p) => p.state === "new" || (retryFailed && p.state === "failed"));
    setBusy(true);
    capStatus.hidden = false;
    let engineFailed = false;
    try {
      if (toRead.length > 0) {
        if (!readerP) capStatus.textContent = "글자 인식 준비 중... (처음엔 한글 데이터 받느라 조금 걸려요)";
        let reader = null;
        try {
          reader = await getReader();
        } catch (err) {
          // 엔진을 못 띄우면 새 장은 못 읽지만, 이미 읽어 둔 장은 아래에서 그대로 다시 합쳐 보여줌
          console.error(err);
          engineFailed = true;
        }
        for (const page of reader ? toRead : []) {
          // 여러 장이면 "2/5장 · "처럼 몇 번째 장인지 함께 보여줌
          const label = pages.length > 1 ? `${pages.indexOf(page) + 1}/${pages.length}장 · ` : "";
          try {
            page.text = await readCapture(reader, page.file, label);
            page.state = "done";
            readCache.set(page.key, { id: page.id, text: page.text });
          } catch (err) {
            console.error(err); // 이 장만 건너뛰고 나머지는 계속 읽음
            page.state = "failed";
          }
        }
      }
      showResult(pages, engineFailed);
    } catch (err) {
      console.error(err);
      capStatus.textContent = OCR_ERROR_MSG;
    } finally {
      setBusy(false);
      updateOcrBtn();
      idleReader();
    }
  }

  function getReader() {
    clearTimeout(readerTimer);
    if (!readerP) {
      const p = createReader();
      readerP = p;
      p.catch(() => {
        if (readerP === p) readerP = null; // 실패하면 다음에 처음부터 다시 띄움
      });
    }
    return readerP;
  }
  function idleReader() {
    clearTimeout(readerTimer);
    if (readerP) readerTimer = setTimeout(dropReader, READER_IDLE_MS);
  }
  function dropReader() {
    clearTimeout(readerTimer);
    const p = readerP;
    readerP = null;
    if (p) p.then((r) => r.terminate()).catch(() => {});
  }

  // 한 장을 읽습니다. 보정본에서 거래를 하나도 못 찾으면, 보정이 오히려 망친 경우일 수 있어 원본으로 한 번 더
  // (수입만 있는 장처럼 잘 읽혔는데 지출만 없는 장은 다시 읽지 않음)
  async function readCapture(reader, file, label) {
    const text = await reader.read(file, (pct) => (capStatus.textContent = `글자 인식 중... ${label}${pct}%`));
    if (hasTransactions(text)) return text;
    capStatus.textContent = `다시 인식 중... ${label}(원본 그대로)`;
    try {
      const rawTry = await reader.read(file, (pct) => (capStatus.textContent = `다시 인식 중... ${label}${pct}%`), { preprocess: false });
      return hasTransactions(rawTry) ? rawTry : text;
    } catch (err) {
      console.warn("원본 재인식 실패 — 보정본 결과 사용", err);
      return text;
    }
  }

  // 읽은 장들을 합쳐 상태 문구·원문·확인 목록을 그립니다.
  function showResult(pages, engineFailed) {
    const texts = pages.map((p) => (p.state === "done" ? p.text : null));
    const { expenses, excludedIncome, overlapped } = mergeCaptures(texts);
    rebuildItems(pages, expenses);
    if (pages.length === 0 && capItems.length === 0) {
      hideResult(); // 사진도, 직접 추가한 내역도 없음 → 처음 상태로
      return;
    }

    const read = texts.filter((t) => t != null).length;
    const failedNos = pages.flatMap((p, i) => (p.state === "failed" ? [i + 1] : []));
    const parts = [];
    if (engineFailed) parts.push(ENGINE_ERROR_MSG);
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
    const recognized = [];
    for (const e of expenses) {
      const keys = [e, ...e.also].map((x) => `${pages[x.src].id}:${x.idx}`);
      if (keys.some((k) => deletedKeys.has(k))) continue;
      const it = { keys, desc: e.merchant, amount: e.amount, dateISO: e.date, time: e.time, src: e.src, edits: editsOf(keys) };
      Object.assign(it, it.edits);
      // 분류를 직접 고르지 않았으면 (고친) 이름으로 자동 분류
      if (!("category" in it.edits)) it.category = smartCategory(it.desc);
      recognized.push(it);
    }
    capItems = [...recognized, ...capItems.filter((it) => it.manual)];
  }

  // 그 거래의 고친 값. 열쇠 중 어느 것으로든 고친 적이 있으면 그 값이고, 열쇠들이 모두 같은 객체를 가리키게 맞춰
  // 이후에 고친 값도 어느 열쇠로든 보이게 함
  function editsOf(keys) {
    const found = [...new Set(keys.map((k) => edits.get(k)).filter(Boolean))];
    const merged = found[0] || {};
    for (const other of found.slice(1)) {
      Object.assign(merged, other);
      for (const [k, v] of edits) if (v === other) edits.set(k, merged);
    }
    for (const k of keys) edits.set(k, merged);
    return merged;
  }

  function hideResult() {
    capItems = [];
    capEditor.hidden = true;
    capStatus.hidden = true;
    capRaw.hidden = true;
  }

  // 저장을 마친 뒤: 고른 사진·읽은 결과·고친 값을 모두 비우고 엔진도 내림
  function clearAll() {
    for (const s of selected) if (s.thumb) URL.revokeObjectURL(s.thumb);
    selected = [];
    readCache.clear();
    edits.clear();
    deletedKeys.clear();
    hideResult();
    renderPreview();
    updateOcrBtn();
    dropReader();
  }

  function setBusy(on) {
    busy = on;
    capFile.disabled = on;
    capOcrBtn.disabled = on;
    capCard.classList.toggle("busy", on);
  }

  // 읽을 장이 남았을 때만 버튼을 보여줌 (결과를 본 뒤엔 실패한 장 다시 읽기용)
  function updateOcrBtn() {
    const unread = selected.filter((s) => s.state !== "done").length;
    capOcrBtn.hidden = unread === 0;
    capOcrBtn.textContent = !showingResult()
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
          ${s.thumb ? `<img src="${s.thumb}" alt="캡쳐 ${i + 1}" />` : `<span class="cap-thumb-wait">불러오는 중…</span>`}
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
  // 값을 고치면 고친 값으로 기억하고(다시 합쳐도 유지), 빈칸 경고는 지움
  const edit = (el, it, field, value) => {
    it[field] = value;
    it.edits[field] = value;
    it.invalid = false;
    el.closest(".cap-row").classList.remove("invalid");
  };

  capEditor.addEventListener("input", (ev) => {
    const it = itemOf(ev.target);
    if (!it) return;
    const cls = ev.target.classList;
    if (cls.contains("cap-desc")) edit(ev.target, it, "desc", ev.target.value);
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
    } else if (cls.contains("cap-desc") && !("category" in it.edits)) {
      // 분류를 직접 고른 적이 없으면, 고친 이름으로 다시 자동 분류 (잘못 읽힌 이름을 고친 경우)
      it.category = smartCategory(it.desc);
      ev.target.closest(".cap-row").querySelector(".cap-cat").value = it.category;
    }
  });
  capEditor.addEventListener("click", (ev) => {
    if (busy) return;
    if (ev.target.closest(".cap-del")) {
      const [removed] = capItems.splice(Number(ev.target.closest(".cap-row").dataset.i), 1);
      if (removed && !removed.manual) removed.keys.forEach((k) => deletedKeys.add(k));
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
    const days = items.map((it) => it.dateISO).filter((d) => parseISO(d)).sort();
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
      manual: true,
      src: "manual",
      desc: "",
      category: "기타",
      amount: 0,
      dateISO: last && parseISO(last.dateISO) ? last.dateISO : todayISO(),
      time: null,
      edits: {},
    });
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
      const day = parseISO(it.dateISO);
      if (!desc || amount <= 0 || !day) {
        it.invalid = true;
        invalid++;
        continue;
      }
      rows.push({ it, desc, amount, day });
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
    // 각 항목을 날짜가 속한 '월'로 묶어서 그 월 문서에 추가
    const groups = new Map();
    for (const { it, desc, amount, day } of rows) {
      const key = `${day.year}_${day.month - 1}`;
      if (!groups.has(key)) groups.set(key, { year: day.year, month: day.month - 1, scanned: [], manual: [], items: [] });
      const g = groups.get(key);
      g.items.push(it);
      g[it.manual ? "manual" : "scanned"].push({
        category: it.category,
        desc,
        amount,
        date: makeEntryDate(day.month - 1, day.day, it.time || "00:00"),
        id: genId(), // 고유 id: 같은 분·같은 금액 두 건(커피 두 잔)도 arrayUnion이 하나로 합치지 않게
      });
    }
    const list = [...groups.values()];
    setBusy(true);
    showLoading(true);
    let results;
    try {
      // 달 문서끼리는 서로 상관없어 한꺼번에 저장 (한 달이 실패해도 나머지 달은 저장됨)
      results = await Promise.allSettled(list.map(async (g) => {
        const data = await loadMonth(g.year, g.month);
        // 이미 저장된 거래는 건너뜀 (같은 캡쳐를 다시 올렸거나, 지난번 저장이 중간에 끊긴 경우).
        // 직접 추가한 줄은 사용자가 '사진에서 빠졌다'고 보고 넣은 것이라 거르지 않음
        const { toAdd, skipped } = newEntriesOnly(data.entries || [], g.scanned);
        const entries = [...toAdd, ...g.manual];
        // 원자적 추가: 다른 가족이 동시에 넣은 내역을 덮어쓰지 않음
        if (entries.length) await appendEntries(g.year, g.month, entries);
        return { year: g.year, month: g.month, count: entries.length, skipped };
      }));
    } finally {
      showLoading(false);
      setBusy(false);
    }
    const saved = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const added = saved.reduce((s, g) => s + g.count, 0);
    const skipped = saved.reduce((s, g) => s + g.skipped, 0);

    if (saved.length < list.length) {
      results.forEach((r) => r.status === "rejected" && console.error(r.reason));
      if (saved.length === 0) {
        showToast("저장 오류. 인터넷 연결을 확인해주세요.", "error");
        return;
      }
      // 저장된 달의 줄은 목록에서 빼서, 다시 누르면 남은 달만 저장되게 (직접 추가한 줄이 두 번 들어가지 않게)
      const done = new Set(list.flatMap((g, i) => (results[i].status === "fulfilled" ? g.items : [])));
      for (const it of done) if (!it.manual) it.keys.forEach((k) => deletedKeys.add(k));
      capItems = capItems.filter((it) => !done.has(it));
      renderCapEditor();
      showToast(`일부(${added}건)만 저장됐어요. 남은 ${capItems.length}건은 '전체 추가'를 다시 눌러주세요.`, "error");
      return;
    }

    clearAll(); // 캡쳐 화면 정리

    const addedMonths = saved.filter((g) => g.count > 0);
    const months = addedMonths.map((g) => `${g.year !== getYear() ? `${g.year}년 ` : ""}${g.month + 1}월 ${g.count}건`);
    const msg =
      added > 0
        ? `✅ ${added}건 추가 완료!${months.length > 1 ? ` (${months.join(" · ")})` : ""}${skipped > 0 ? ` 중복 ${skipped}건은 건너뛰었어요.` : ""}`
        : `이미 다 추가된 내역이에요 (중복 ${skipped}건 건너뜀).`;
    capStatus.hidden = false;
    capStatus.textContent = msg;
    showToast(msg);
    if (added === 0) return;
    // 보고 있는 달에 추가된 게 없으면, 가장 많이 추가된 달을 잠깐 보여줌 ('추가' 탭으로 가면 원래 달로 돌아감)
    const target =
      addedMonths.find((g) => g.year === getYear() && g.month === getMonth()) ||
      addedMonths.reduce((a, b) => (b.count > a.count ? b : a));
    await peekMonth(target.year, target.month);
    switchView("list");
  }
}

// 같은 사진인지 알아보는 열쇠: 내용의 해시. File 객체는 고를 때마다 새로 만들어지고, 폰 사진첩은 같은 사진도
// 고를 때마다 이름·수정 시각을 새로 매기기도 해서 내용으로 비교한다. (해시를 못 쓰는 환경이면 파일 정보로)
async function fileKey(file) {
  try {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
    return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return `${file.name}|${file.size}|${file.lastModified}`;
  }
}

// 거래내역으로 읽혔는지 (지출이나 수입이 하나라도 있으면)
function hasTransactions(text) {
  const r = parseTransactions(text);
  return r.expenses.length > 0 || r.incomes.length > 0;
}
