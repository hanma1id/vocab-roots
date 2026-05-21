/* ============================================================
 * prefix-page.js — 접두어 상세 페이지 (prefix.html?id=in) 동작
 * ------------------------------------------------------------
 *   - 접두어 인덱스에서 해당 접두어를 찾는다
 *   - 등장하는 모든 어원과 단어를 결합 헤더 + 단어 칩으로 보여준다
 *   - 단어 칩 탭 시 그 자리에 IPA·뜻·예문 카드가 인라인 펼침
 *     (어원 페이지로 이동하지 않아 학습 흐름이 끊기지 않음)
 *   - 펼친 카드 안에 "이 어원 전체 보기" 명시 링크
 * ============================================================ */

import { loadPrefix, loadRoot, registerServiceWorker } from "./data-loader.js";
import { speak } from "./tts.js";

registerServiceWorker();

const $panel  = document.getElementById("prefixPanel");
const $area   = document.getElementById("occurrenceArea");
const $title  = document.getElementById("pageTitle");
const $loading = document.getElementById("loading");

const params = new URLSearchParams(location.search);
const prefixId = params.get("id");

function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPanel(p) {
  const totalWords = p.occurrences.reduce((s, o) => s + o.words.length, 0);
  $panel.innerHTML = `
    <div class="origin">접두어</div>
    <div class="form">${esc(p.form)}</div>
    <div class="meaning">${esc(p.meaning || "")}</div>
    <p class="story">
      이 접두어는 어원 ${p.occurrences.length}개에 걸쳐 단어 ${totalWords}개에 등장합니다.
      같은 접두어가 어떻게 다른 어근과 결합해 새 의미를 만드는지 비교해 보세요.
    </p>
  `;
}

function renderOccurrence(occ, prefixForm) {
  // 단어 칩 — 클릭 시 인라인 펼침
  const wordChips = occ.words.map((w) => `
    <button class="prefix-word-chip" type="button"
            data-action="open-word"
            data-root="${esc(occ.root)}"
            data-word="${esc(w)}">
      ${esc(w)}
    </button>
  `).join("");

  return `
    <section class="prefix-section" data-root="${esc(occ.root)}">
      <header class="combine-header">
        <span class="combine-tag">결합</span>
        <span class="combine-prefix">${esc(prefixForm)}</span>
        <span class="combine-plus">+</span>
        <a class="combine-root" href="root.html?id=${encodeURIComponent(occ.root)}"
           title="이 어원 전체 보기">
          <span class="combine-root-form">${esc(occ.rootForm)}</span>
          <span class="combine-root-label">어근</span>
        </a>
        <span class="combine-arrow">→</span>
        <span class="combine-root-meaning">${esc(occ.rootMeaning)}</span>
      </header>
      <div class="prefix-word-list">${wordChips}</div>
    </section>
  `;
}

/* ---------- 단어 인라인 펼침 ---------- */
function findWordInRoot(rootData, wordLower) {
  for (const sec of rootData.tree || []) {
    for (const w of sec.words || []) {
      if (w.word.toLowerCase() === wordLower) return { w, prefix: sec.prefix };
    }
  }
  return null;
}

function renderWordDetail(found, rootId) {
  if (!found) {
    return `<div class="rd-empty">단어 정보를 찾지 못했어요</div>`;
  }
  const w = found.w;
  const syn = w.synonyms?.length
    ? `<div class="rd-related"><span class="rd-label good">유의어</span>${esc(w.synonyms.join(", "))}</div>` : "";
  const ant = w.antonyms?.length
    ? `<div class="rd-related"><span class="rd-label bad">반의어</span>${esc(w.antonyms.join(", "))}</div>` : "";
  return `
    <div class="rd-head">
      <span class="rd-word">${esc(w.word)}</span>
      ${w.ipa ? `<span class="rd-ipa">${esc(w.ipa)}</span>` : ""}
      ${w.pos ? `<span class="rd-pos">${esc(w.pos)}</span>` : ""}
      <button class="rd-tts" type="button" data-action="tts" data-word="${esc(w.word)}" title="발음 듣기">🔊</button>
    </div>
    <div class="rd-meaning">${esc(w.meaning)}</div>
    ${w.example ? `
      <div class="rd-example">
        ${esc(w.example)}
        ${w.exampleKo ? `<span class="ko">${esc(w.exampleKo)}</span>` : ""}
      </div>` : ""}
    ${syn}
    ${ant}
    <a class="rd-rootlink" href="root.html?id=${encodeURIComponent(rootId)}#${encodeURIComponent(w.word.toLowerCase())}">
      이 어원 전체 보기 →
    </a>
  `;
}

async function toggleWordDetail(chip) {
  // 이미 펼친 게 같은 칩의 다음 형제면 닫음
  const next = chip.nextElementSibling;
  if (next && next.classList.contains("rd-card")) {
    next.remove();
    chip.classList.remove("open");
    return;
  }
  // 다른 곳에 펼쳐진 거 모두 닫고
  $area.querySelectorAll(".rd-card").forEach((el) => el.remove());
  $area.querySelectorAll(".prefix-word-chip.open").forEach((el) => el.classList.remove("open"));

  chip.classList.add("open");
  const card = document.createElement("div");
  card.className = "rd-card";
  card.innerHTML = `<div class="rd-loading">불러오는 중…</div>`;
  chip.after(card);

  const rootId = chip.dataset.root;
  const word = chip.dataset.word;
  try {
    const rootData = await loadRoot(rootId);
    const found = findWordInRoot(rootData, word.toLowerCase());
    card.innerHTML = renderWordDetail(found, rootId);
  } catch (err) {
    card.innerHTML = `<div class="rd-empty">불러오기 실패</div>`;
    console.error(err);
  }
}

function bindEvents() {
  $area.addEventListener("click", (e) => {
    const tts = e.target.closest("[data-action='tts']");
    if (tts) {
      e.stopPropagation();
      speak(tts.dataset.word);
      return;
    }
    const chip = e.target.closest("[data-action='open-word']");
    if (chip) {
      e.preventDefault();
      toggleWordDetail(chip);
    }
  });
}

async function main() {
  if (!prefixId) {
    $loading.textContent = "접두어 id가 지정되지 않았어요.";
    return;
  }
  try {
    const p = await loadPrefix(prefixId);
    $loading.style.display = "none";
    $title.textContent = `${p.form} — ${p.meaning || ""}`;
    document.title = `${p.form} — 접두어 학습`;
    renderPanel(p);
    $area.innerHTML = p.occurrences.map((o) => renderOccurrence(o, p.form)).join("");
    bindEvents();
  } catch (err) {
    $loading.textContent = "접두어 데이터를 불러오지 못했어요.";
    console.error(err);
  }
}

main();
