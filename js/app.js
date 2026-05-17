/* ============================================================
 * app.js — 홈(index.html) 동작
 * ------------------------------------------------------------
 *   - 상단 검색창 — 단어/어원/접두어 어느 것이든 부분 일치 검색
 *   - 필터 칩 — 전체 / 라틴어 어원 / 그리스어 어원 / 접두어
 *   - 한 그리드에 어원 카드와 접두어 카드를 모두 표시
 *   - 진도 — 어원당 학습 여부 / 단어당 퀴즈 결과를 색으로 표시
 * ============================================================ */

import {
  loadRootIndex,
  loadPrefixIndex,
  loadWordIndex,
  loadGlossary,
  loadRelated,
  isRootDone,
  getWordStat,
  registerServiceWorker,
} from "./data-loader.js";

const $cardArea  = document.getElementById("cardArea");
const $chips     = document.getElementById("filterChips");
const $loading   = document.getElementById("loading");
const $search    = document.getElementById("searchInput");
const $searchClear = document.getElementById("searchClear");
const $searchResults = document.getElementById("searchResults");

let _roots = [];
let _prefixes = [];
let _words = [];
let _glossary = {};         // { word(lowercase): {ipa, meaning} }
let _related = {};          // { word(lowercase): [{root, word, role}, ...] }
let _filter = "all";        // "all" | "latin" | "greek" | "prefix"

/* ---------- 렌더링 ---------- */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderRootCard(r) {
  const done = isRootDone(r.id) ? " done" : "";
  const originKo = r.origin === "Latin" ? "라틴어" :
                   r.origin === "Greek" ? "그리스어" : r.origin;
  return `
    <a class="root-card${done}" href="root.html?id=${encodeURIComponent(r.id)}">
      <span class="card-tag root-tag">어원</span>
      <div>
        <div class="root-form">${esc(r.rootForm)}</div>
        <div class="root-meaning">${esc(r.meaning)}</div>
      </div>
      <div class="root-meta">
        <span>${originKo}</span>
        <span>단어 ${r.wordCount ?? "?"}개</span>
      </div>
    </a>
  `;
}

function renderPrefixCard(p) {
  const wordCount = p.occurrences.reduce((s, o) => s + o.words.length, 0);
  return `
    <a class="root-card prefix-card" href="prefix.html?id=${encodeURIComponent(p.id)}">
      <span class="card-tag prefix-tag">접두어</span>
      <div>
        <div class="root-form">${esc(p.form)}</div>
        <div class="root-meaning">${esc(p.meaning || "")}</div>
      </div>
      <div class="root-meta">
        <span>어원 ${p.occurrences.length}개</span>
        <span>단어 ${wordCount}개</span>
      </div>
    </a>
  `;
}

function renderGrid() {
  const cards = [];
  const showRoots  = _filter === "all" || _filter === "latin" || _filter === "greek";
  const showPrefix = _filter === "all" || _filter === "prefix";

  if (showRoots) {
    let rs = _roots;
    if (_filter === "latin") rs = rs.filter(r => r.origin === "Latin");
    if (_filter === "greek") rs = rs.filter(r => r.origin === "Greek");
    cards.push(...rs.map(renderRootCard));
  }
  if (showPrefix) {
    cards.push(..._prefixes.map(renderPrefixCard));
  }

  if (!cards.length) {
    $cardArea.innerHTML = `<div class="empty">표시할 항목이 없습니다</div>`;
    return;
  }
  $cardArea.innerHTML = cards.join("");
}

/* ---------- 검색 ----------
 * 단어/어원 form/한국어 의미/접두어 form 모두 부분일치.
 * 한글로 입력하면 단어 meaning에서, 영어면 word/rootForm/prefix에서 매칭.
 */
function searchMatch(q) {
  q = q.trim().toLowerCase();
  if (!q) return null;

  const results = { words: [], related: [], roots: [], prefixes: [] };
  const seenWords = new Set();

  // 1) 자체 어원 단어 — 영문/한글 모두
  for (const it of _words) {
    if (
      it.w.toLowerCase().includes(q) ||
      (it.m && it.m.toLowerCase().includes(q))
    ) {
      results.words.push(it);
      seenWords.add(it.w.toLowerCase());
      if (results.words.length >= 30) break;
    }
  }

  // 2) 유의어/반의어 단어 (glossary) — 자체 단어와 중복 안 되게
  for (const [key, info] of Object.entries(_glossary)) {
    if (seenWords.has(key)) continue;
    const meaningHit = info.meaning && info.meaning.toLowerCase().includes(q);
    const wordHit = key.includes(q);
    if (!meaningHit && !wordHit) continue;

    // 등장 위치 — 어느 어원 단어의 syn/ant로 나오는지
    const occurrences = _related[key] || [];
    results.related.push({
      w: key,
      m: info.meaning || "",
      p: info.ipa || "",
      occurrences,
    });
    if (results.related.length >= 30) break;
  }

  // 3) 어원
  for (const r of _roots) {
    if (
      r.rootForm.toLowerCase().includes(q) ||
      (r.meaning && r.meaning.toLowerCase().includes(q)) ||
      r.id.toLowerCase().includes(q)
    ) {
      results.roots.push(r);
      if (results.roots.length >= 10) break;
    }
  }

  // 4) 접두어
  for (const p of _prefixes) {
    if (
      p.form.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      (p.meaning && p.meaning.toLowerCase().includes(q))
    ) {
      results.prefixes.push(p);
      if (results.prefixes.length >= 10) break;
    }
  }
  return results;
}

function renderSearch(r) {
  if (!r) {
    $searchResults.hidden = true;
    $searchResults.innerHTML = "";
    $cardArea.hidden = false;
    return;
  }
  const html = [];

  if (r.words.length) {
    html.push(`<div class="search-section-title">단어 ${r.words.length}개</div>`);
    html.push(`<div class="search-word-list">`);
    for (const w of r.words) {
      const stat = getWordStat(w.w);
      const mark = stat === "passed" ? `<span class="mark good">✓</span>`
                 : stat === "failed" ? `<span class="mark bad">✗</span>` : "";
      html.push(`
        <a class="search-word-item" href="root.html?id=${encodeURIComponent(w.root)}#${encodeURIComponent(w.w)}">
          <span class="search-word">${esc(w.w)}${mark}</span>
          <span class="search-word-meaning">${esc(w.m)}</span>
          <span class="search-word-root">${esc(w.rootForm)}</span>
        </a>
      `);
    }
    html.push(`</div>`);
  }

  if (r.related.length) {
    html.push(`<div class="search-section-title">유의어·반의어로 나온 단어 ${r.related.length}개</div>`);
    html.push(`<div class="search-word-list">`);
    for (const w of r.related) {
      // 등장 위치가 있으면 첫 번째 위치로 이동 + 해시로 그 단어 카드 펼침
      // 없으면(드물지만) 링크 비활성 div
      const occ = w.occurrences[0];
      const roleKo = occ?.role === "synonym" ? "유의어" : "반의어";
      const hint = occ
        ? `${esc(occ.rootForm)} 어원의 <b>${esc(occ.word)}</b>의 ${roleKo}`
        : `사전 단어`;
      const ipa = w.p ? `<span class="search-ipa">${esc(w.p)}</span>` : "";

      if (occ) {
        const href = `root.html?id=${encodeURIComponent(occ.root)}#${encodeURIComponent(occ.word)}`;
        html.push(`
          <a class="search-word-item related-result" href="${href}">
            <span class="search-word">${esc(w.w)}${ipa}</span>
            <span class="search-word-meaning">${esc(w.m)}</span>
            <span class="search-word-root">${hint}</span>
          </a>
        `);
      } else {
        html.push(`
          <div class="search-word-item related-result no-link">
            <span class="search-word">${esc(w.w)}${ipa}</span>
            <span class="search-word-meaning">${esc(w.m)}</span>
            <span class="search-word-root">${hint}</span>
          </div>
        `);
      }
    }
    html.push(`</div>`);
  }

  if (r.roots.length) {
    html.push(`<div class="search-section-title">어원 ${r.roots.length}개</div>`);
    html.push(`<div class="search-mini-grid">`);
    for (const root of r.roots) {
      html.push(`
        <a class="search-mini-card" href="root.html?id=${encodeURIComponent(root.id)}">
          <span class="root-form">${esc(root.rootForm)}</span>
          <span class="root-meaning">${esc(root.meaning)}</span>
        </a>
      `);
    }
    html.push(`</div>`);
  }

  if (r.prefixes.length) {
    html.push(`<div class="search-section-title">접두어 ${r.prefixes.length}개</div>`);
    html.push(`<div class="search-mini-grid">`);
    for (const p of r.prefixes) {
      html.push(`
        <a class="search-mini-card" href="prefix.html?id=${encodeURIComponent(p.id)}">
          <span class="root-form">${esc(p.form)}</span>
          <span class="root-meaning">${esc(p.meaning || "")}</span>
        </a>
      `);
    }
    html.push(`</div>`);
  }

  if (!html.length) {
    html.push(`<div class="empty">검색 결과가 없습니다</div>`);
  }

  $searchResults.innerHTML = html.join("");
  $searchResults.hidden = false;
  $cardArea.hidden = true;
}

/* ---------- 이벤트 바인딩 ---------- */
function bindChips() {
  $chips.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-filter]");
    if (!btn) return;
    _filter = btn.dataset.filter;
    $chips.querySelectorAll("button").forEach(b =>
      b.classList.toggle("active", b === btn)
    );
    renderGrid();
  });
}

function bindSearch() {
  let timer = null;
  const run = () => {
    const q = $search.value.trim();
    $searchClear.hidden = !q;
    if (!q) {
      renderSearch(null);
      return;
    }
    renderSearch(searchMatch(q));
  };
  $search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, 120);  // 키 누를 때마다가 아니라 살짝 지연
  });
  $searchClear.addEventListener("click", () => {
    $search.value = "";
    $search.focus();
    renderSearch(null);
    $searchClear.hidden = true;
  });
}

/* ---------- 부트스트랩 ---------- */
async function main() {
  bindChips();
  bindSearch();
  registerServiceWorker();
  try {
    // 모든 데이터 병렬 로드 — glossary/related는 검색 보조용
    const [roots, prefixData, words, glossary, related] = await Promise.all([
      loadRootIndex(),
      loadPrefixIndex(),
      loadWordIndex(),
      loadGlossary(),
      loadRelated(),
    ]);
    _roots = roots;
    _prefixes = prefixData.prefixes || [];
    _words = words;
    _glossary = glossary || {};
    _related = related || {};
    $loading.style.display = "none";
    renderGrid();
  } catch (err) {
    $loading.textContent = "데이터를 불러오지 못했어요. 새로고침 해 보세요.";
    console.error(err);
  }
}

main();
