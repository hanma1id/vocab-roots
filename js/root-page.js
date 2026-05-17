/* ============================================================
 * root-page.js — 어원 상세 페이지(root.html?id=xxx) 동작
 * ------------------------------------------------------------
 *   - URL 쿼리스트링 id로 해당 어원 JSON을 로드
 *   - 어원 패널과 접두어별 단어 카드 트리를 그린다
 *   - 단어 카드 탭하면 인라인으로 상세(예문/유의어/반의어)가 펼쳐짐
 *   - 발음 버튼을 누르면 TTS 재생
 *   - 「다 봤어요」 버튼으로 진도 토글, 이전/다음 어원 이동
 * ============================================================ */

import {
  loadRoot,
  loadRootIndex,
  isRootDone,
  toggleRootDone,
  setLastVisited,
  getWordStat,
  rootProgress,
  lookupWord,
  registerServiceWorker,
} from "./data-loader.js";
import { speak } from "./tts.js";

registerServiceWorker();

const $panel = document.getElementById("rootPanel");
const $tree = document.getElementById("treeArea");
const $footer = document.getElementById("rootFooter");
const $title = document.getElementById("pageTitle");
const $loading = document.getElementById("loading");

const params = new URLSearchParams(location.search);
const rootId = params.get("id");

/* ---------- HTML 이스케이프 — XSS 방지 ----------
 * 어원 JSON은 내가 만든 데이터지만, 향후 사용자 입력이나
 * Gemini 생성 데이터가 들어올 수 있으니 일관되게 이스케이프한다. */
function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------- 렌더링 ---------- */
function renderPanel(root) {
  const originKo =
    root.origin === "Latin" ? "라틴어"
    : root.origin === "Greek" ? "그리스어"
    : root.origin;
  $panel.innerHTML = `
    <div class="origin">${esc(originKo)}</div>
    <div class="form">${esc(root.rootForm)}</div>
    <div class="meaning">${esc(root.meaning)}</div>
    <p class="story">${esc(root.story)}</p>
  `;
}

function renderRelatedChips(list, kind) {
  // kind — "syn" | "ant"
  return list.map((word) => `
    <button class="related-chip ${kind}-chip" type="button"
            data-action="lookup" data-word="${esc(word)}">
      ${esc(word)}
    </button>
  `).join("");
}

function renderWord(w) {
  // 유의어/반의어 — 칩으로 변환, 탭하면 그 자리에 IPA·뜻 인라인 카드가 펼쳐짐
  const syn = w.synonyms?.length
    ? `<div class="related syn">
         <span class="label">유의어</span>
         <div class="related-chips">${renderRelatedChips(w.synonyms, "syn")}</div>
       </div>`
    : "";
  const ant = w.antonyms?.length
    ? `<div class="related ant">
         <span class="label">반의어</span>
         <div class="related-chips">${renderRelatedChips(w.antonyms, "ant")}</div>
       </div>`
    : "";
  const exampleKo = w.exampleKo
    ? `<span class="ko">${esc(w.exampleKo)}</span>`
    : "";

  // 퀴즈 결과 — ✓ 통과 / ✗ 실패 / 빈 = 안 풀음
  const stat = getWordStat(w.word);
  const statMark =
    stat === "passed" ? `<span class="word-status good" title="퀴즈 통과">✓</span>` :
    stat === "failed" ? `<span class="word-status bad" title="퀴즈 실패 — 다시 학습">✗</span>` :
    `<span class="word-status none" title="아직 안 풀음">·</span>`;

  return `
    <div class="word-card status-${stat || 'none'}" aria-expanded="false" id="w-${esc(w.word.toLowerCase())}">
      <button class="word-head" type="button" data-action="toggle">
        ${statMark}
        <span class="word">${esc(w.word)}</span>
        ${w.ipa ? `<span class="ipa">${esc(w.ipa)}</span>` : ""}
        <span class="tts-btn" data-action="tts" data-word="${esc(w.word)}" title="발음 듣기">🔊</span>
        <span class="chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="word-body">
        ${w.pos ? `<span class="pos">${esc(w.pos)}</span>` : ""}
        <div class="meaning">${esc(w.meaning)}</div>
        <div class="example">
          ${esc(w.example)}
          ${exampleKo}
        </div>
        ${syn}
        ${ant}
      </div>
    </div>
  `;
}

function renderTree(root) {
  if (!root.tree || !root.tree.length) {
    $tree.innerHTML = `<div class="empty">파생 단어가 아직 없습니다</div>`;
    return;
  }
  $tree.innerHTML = root.tree.map((section) => `
    <section class="prefix-section">
      <header class="prefix-header">
        <span class="prefix">${esc(section.prefix || "기본형")}</span>
        ${section.prefixMeaning ? `<span class="prefix-meaning">${esc(section.prefixMeaning)}</span>` : ""}
      </header>
      <div class="word-grid">
        ${section.words.map(renderWord).join("")}
      </div>
    </section>
  `).join("");
}

function renderFooter(root, index) {
  // 인덱스에서 현재 어원의 위치를 찾아 이전/다음 어원 결정
  const pos = index.findIndex((r) => r.id === root.id);
  const prev = pos > 0 ? index[pos - 1] : null;
  const next = pos < index.length - 1 ? index[pos + 1] : null;
  const done = isRootDone(root.id);
  const prog = rootProgress(root);

  // 진도 텍스트
  const progText = prog.total
    ? `${prog.passed}/${prog.total} 통과`
    : "";

  $footer.innerHTML = `
    <div class="footer-row">
      <a class="quiz-btn" href="quiz.html?root=${encodeURIComponent(root.id)}">
        🎯 이 어원 퀴즈 풀기
        ${progText ? `<span class="quiz-progress">${progText}</span>` : ""}
      </a>
    </div>
    <div class="footer-row">
      <button class="secondary" data-action="prev" ${prev ? "" : "disabled"}>
        ${prev ? `← ${esc(prev.rootForm)}` : "← 이전 어원"}
      </button>
      <button class="${done ? "done-state" : ""}" data-action="toggle-done">
        ${done ? "✓ 다 봤어요" : "이 어원 다 봤어요"}
      </button>
      <button class="secondary" data-action="next" ${next ? "" : "disabled"}>
        ${next ? `${esc(next.rootForm)} →` : "다음 어원 →"}
      </button>
    </div>
  `;

  $footer.onclick = (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "prev" && prev) location.href = `root.html?id=${encodeURIComponent(prev.id)}`;
    if (action === "next" && next) location.href = `root.html?id=${encodeURIComponent(next.id)}`;
    if (action === "toggle-done") {
      toggleRootDone(root.id);
      renderFooter(root, index);
    }
  };
}

/* ---------- 칩에 마우스 호버 풍선용 뜻 미리 채우기 ----------
 * 페이지의 모든 유의어/반의어 칩에 대해 lookupWord를 한 번씩 돌려
 * data-meaning 속성을 채워둔다. CSS의 :hover::after가 이걸 풍선으로 표시. */
async function hydrateChipTooltips() {
  const chips = $tree.querySelectorAll(".related-chip[data-word]:not([data-meaning])");
  // 중복 단어는 한 번만 조회 — 효율
  const seen = new Map(); // word → meaning
  for (const chip of chips) {
    const w = chip.dataset.word;
    const key = w.toLowerCase();
    let m = seen.get(key);
    if (m === undefined) {
      const info = await lookupWord(w);
      m = info ? (info.meaning || "") : "";
      seen.set(key, m);
    }
    if (m) chip.setAttribute("data-meaning", m);
  }
}

/* ---------- 단어 정보 미니 카드 (유의어/반의어 펼침용) ----------
 * 같은 칩을 다시 탭하면 닫힘.
 * 사전에 없는 단어는 "사전에 없어요" 안내. */
async function toggleRelatedDetail(chip) {
  // 이미 펼친 상태? 닫고 종료
  const existing = chip.nextElementSibling;
  if (existing && existing.classList.contains("related-detail")) {
    existing.remove();
    chip.classList.remove("open");
    return;
  }
  // 같은 단어가 다른 곳에 펼쳐져 있으면 그것도 닫음 — 깔끔하게
  $tree.querySelectorAll(".related-detail").forEach((el) => el.remove());
  $tree.querySelectorAll(".related-chip.open").forEach((el) => el.classList.remove("open"));

  chip.classList.add("open");

  // 임시 "로딩…" 카드 먼저
  const word = chip.dataset.word;
  const card = document.createElement("div");
  card.className = "related-detail";
  card.innerHTML = `<div class="rd-word">${word}</div><div class="rd-loading">불러오는 중…</div>`;
  chip.after(card);

  const info = await lookupWord(word);
  if (!info) {
    card.innerHTML = `
      <div class="rd-word">${word}</div>
      <div class="rd-empty">사전에 없는 단어예요</div>
    `;
    return;
  }
  // 다른 어원 안의 단어면 어원 페이지로 가는 링크도 표시
  const rootLink = info.root
    ? `<a class="rd-rootlink" href="root.html?id=${encodeURIComponent(info.root)}#${encodeURIComponent(word.toLowerCase())}">
         ${info.rootForm} 어원으로 보기 →
       </a>`
    : "";
  card.innerHTML = `
    <div class="rd-head">
      <span class="rd-word">${word}</span>
      ${info.ipa ? `<span class="rd-ipa">${info.ipa}</span>` : ""}
      <button class="rd-tts" type="button" data-action="tts" data-word="${word}" title="발음 듣기">🔊</button>
    </div>
    <div class="rd-meaning">${info.meaning || "—"}</div>
    ${rootLink}
  `;
}

/* ---------- 트리 영역 이벤트 — 카드 토글과 TTS와 칩 ---------- */
function bindTreeEvents() {
  $tree.addEventListener("click", (e) => {
    // 발음 버튼 — 부모로 이벤트 전파 막기
    const ttsTarget = e.target.closest("[data-action='tts']");
    if (ttsTarget) {
      e.stopPropagation();
      speak(ttsTarget.dataset.word);
      return;
    }
    // 유의어/반의어 칩
    const chip = e.target.closest("[data-action='lookup']");
    if (chip) {
      e.stopPropagation();
      toggleRelatedDetail(chip);
      return;
    }
    // 단어 카드 헤더 — 펼침/접힘
    const head = e.target.closest("[data-action='toggle']");
    if (!head) return;
    const card = head.closest(".word-card");
    const expanded = card.getAttribute("aria-expanded") === "true";
    card.setAttribute("aria-expanded", expanded ? "false" : "true");
  });
}

/* ---------- 부트스트랩 ---------- */
async function main() {
  if (!rootId) {
    $loading.textContent = "어원 id가 지정되지 않았어요.";
    return;
  }
  try {
    // 어원 상세와 전체 인덱스를 병렬로 로드
    const [root, index] = await Promise.all([
      loadRoot(rootId),
      loadRootIndex()
    ]);
    $loading.style.display = "none";
    $title.textContent = `${root.rootForm} — ${root.meaning}`;
    document.title = `${root.rootForm} — 어원 학습`;

    renderPanel(root);
    renderTree(root);
    renderFooter(root, index);
    bindTreeEvents();
    hydrateChipTooltips();
    setLastVisited(root.id);

    // URL #해시로 특정 단어 카드가 지정됐다면 펼치고 스크롤
    const hash = decodeURIComponent(location.hash.replace(/^#/, "")).toLowerCase();
    if (hash) {
      const card = document.getElementById(`w-${hash}`);
      if (card) {
        card.setAttribute("aria-expanded", "true");
        // 헤더 sticky를 감안해 살짝 위로 보이게
        setTimeout(() => card.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      }
    }
  } catch (err) {
    $loading.textContent = "어원 데이터를 불러오지 못했어요.";
    console.error(err);
  }
}

main();
