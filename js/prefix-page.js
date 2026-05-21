/* ============================================================
 * prefix-page.js — 접두어 상세 페이지 (prefix.html?id=in) 동작
 * ------------------------------------------------------------
 *   - 접두어 인덱스에서 해당 접두어를 찾는다
 *   - 등장하는 모든 어원과 단어를 어원 카드 풍으로 나열
 *   - 단어 카드 탭하면 어원 상세로 이동
 * ============================================================ */

import { loadPrefix, registerServiceWorker } from "./data-loader.js";

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
  // 어원 한 개 안에서 그 접두어가 만든 단어들
  const wordChips = occ.words.map((w) => `
    <a class="prefix-word-chip"
       href="root.html?id=${encodeURIComponent(occ.root)}">
      ${esc(w)}
    </a>
  `).join("");

  // 헤더 — "[접두어] + [어근] → 어근 뜻" 으로 결합을 시각화
  return `
    <section class="prefix-section">
      <header class="combine-header">
        <span class="combine-tag">결합</span>
        <span class="combine-prefix">${esc(prefixForm)}</span>
        <span class="combine-plus">+</span>
        <span class="combine-root">
          <span class="combine-root-form">${esc(occ.rootForm)}</span>
          <span class="combine-root-label">어근</span>
        </span>
        <span class="combine-arrow">→</span>
        <span class="combine-root-meaning">${esc(occ.rootMeaning)}</span>
      </header>
      <div class="prefix-word-list">${wordChips}</div>
    </section>
  `;
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
  } catch (err) {
    $loading.textContent = "접두어 데이터를 불러오지 못했어요.";
    console.error(err);
  }
}

main();
