/* ============================================================
 * quiz-page.js — 어원 단위 묶음 퀴즈 (4지선다 영→한)
 * ------------------------------------------------------------
 *   - URL ?root=<id> 로 어원 지정
 *   - 그 어원의 모든 단어를 무작위 순서로 출제
 *   - 오답 보기는 같은 어원 내 다른 단어 뜻에서 우선 추출
 *     (전체 단어 인덱스에서 보충)
 *   - 정/오답 즉시 피드백, 끝나면 점수 + 단어별 상태 저장
 * ============================================================ */

import { loadRoot, loadWordIndex, setWordStats, registerServiceWorker } from "./data-loader.js";

registerServiceWorker();

const $loading    = document.getElementById("loading");
const $title      = document.getElementById("pageTitle");
const $progBar    = document.getElementById("quizProgressBar");
const $progFill   = document.getElementById("quizProgressFill");
const $progText   = document.getElementById("quizProgressText");
const $question   = document.getElementById("quizQuestion");
const $choices    = document.getElementById("quizChoices");
const $feedback   = document.getElementById("quizFeedback");
const $nextBtn    = document.getElementById("quizNextBtn");
const $result     = document.getElementById("quizResult");

const params = new URLSearchParams(location.search);
const rootId = params.get("root");

let _allWords = [];     // 출제 큐
let _pool = [];         // 오답 후보 풀 (이 어원 단어 + 다른 단어)
let _idx = 0;           // 현재 문제 번호 (0-based)
let _results = [];      // [{word, status}] — 마지막에 저장
let _locked = false;    // 답 선택 후 잠금

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function shuffle(arr) {
  // Fisher–Yates
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function flattenRoot(root) {
  const words = [];
  for (const sec of root.tree || []) {
    for (const w of sec.words || []) {
      words.push({
        word: w.word,
        meaning: w.meaning,
        ipa: w.ipa,
        example: w.example,
        prefix: sec.prefix,
      });
    }
  }
  return words;
}

/* ---------- 오답 보기 만들기 ----------
 * 1순위 — 이 어원 안에서 현재 단어 외 다른 단어 뜻 (의미적으로 가까워 헷갈리도록)
 * 2순위 — 전체 단어 인덱스에서 무작위 (보충)
 */
function pickDistractors(currentWord, pool, allWords, count = 3) {
  const usedMeanings = new Set([currentWord.meaning.toLowerCase()]);
  const out = [];

  // 같은 어원 단어 먼저
  for (const w of shuffle(pool)) {
    if (w.word === currentWord.word) continue;
    if (!w.meaning) continue;
    const key = w.meaning.toLowerCase();
    if (usedMeanings.has(key)) continue;
    usedMeanings.add(key);
    out.push(w.meaning);
    if (out.length >= count) return out;
  }

  // 부족하면 전체 단어에서 보충
  for (const w of shuffle(allWords)) {
    if (!w.m) continue;
    const key = w.m.toLowerCase();
    if (usedMeanings.has(key)) continue;
    usedMeanings.add(key);
    out.push(w.m);
    if (out.length >= count) return out;
  }

  return out;
}

/* ---------- 문제 렌더링 ---------- */
function renderQuestion() {
  if (_idx >= _allWords.length) {
    finish();
    return;
  }
  _locked = false;
  const cur = _allWords[_idx];
  const distractors = pickDistractors(cur, _pool, _wordsIndex, 3);
  const choices = shuffle([cur.meaning, ...distractors]);

  // 진행도
  $progBar.hidden = false;
  $progFill.style.width = `${(_idx / _allWords.length) * 100}%`;
  $progText.textContent = `${_idx + 1} / ${_allWords.length}`;

  // 문제
  $question.hidden = false;
  $question.innerHTML = `
    <div class="quiz-word">${esc(cur.word)}</div>
    ${cur.ipa ? `<div class="quiz-ipa">${esc(cur.ipa)}</div>` : ""}
    <div class="quiz-prompt">한국어 뜻을 골라 보세요</div>
  `;

  // 보기 4개
  $choices.hidden = false;
  $choices.innerHTML = choices.map((c, i) => `
    <button class="quiz-choice" data-meaning="${esc(c)}" data-correct="${c === cur.meaning ? '1' : '0'}">
      <span class="choice-num">${i + 1}</span>
      <span class="choice-text">${esc(c)}</span>
    </button>
  `).join("");

  $feedback.hidden = true;
  $feedback.innerHTML = "";
  $nextBtn.hidden = true;
}

/* ---------- 정답 처리 ---------- */
function handleAnswer(btn) {
  if (_locked) return;
  _locked = true;
  const correct = btn.dataset.correct === "1";
  const cur = _allWords[_idx];

  // 모든 보기를 잠그고 정답/오답 표시
  $choices.querySelectorAll(".quiz-choice").forEach((b) => {
    b.disabled = true;
    if (b.dataset.correct === "1") b.classList.add("correct");
    else if (b === btn) b.classList.add("wrong");
  });

  _results.push({ word: cur.word, status: correct ? "passed" : "failed" });

  $feedback.hidden = false;
  $feedback.className = `quiz-feedback ${correct ? "good" : "bad"}`;
  $feedback.innerHTML = correct
    ? `<span class="feedback-mark">✓</span> 정답이에요!`
    : `<span class="feedback-mark">✗</span> 정답은 <b>${esc(cur.meaning)}</b>`;

  $nextBtn.hidden = false;
  $nextBtn.textContent = _idx + 1 >= _allWords.length ? "결과 보기" : "다음 →";
  $nextBtn.focus();
}

/* ---------- 결과 화면 ---------- */
function finish() {
  // 결과 저장
  setWordStats(_results);

  $progBar.hidden = true;
  $question.hidden = true;
  $choices.hidden = true;
  $feedback.hidden = true;
  $nextBtn.hidden = true;
  $result.hidden = false;

  const passed = _results.filter(r => r.status === "passed").length;
  const failed = _results.length - passed;
  const rate = Math.round((passed / _results.length) * 100);

  // 틀린 단어 목록
  const wrongList = _results
    .filter(r => r.status === "failed")
    .map(r => {
      // 원래 단어 정보를 찾아 의미도 함께
      const w = _allWords.find(x => x.word === r.word);
      return `<li><b>${esc(r.word)}</b> — ${esc(w?.meaning || "")}</li>`;
    })
    .join("");

  $result.innerHTML = `
    <div class="result-score">
      <div class="score-big">${passed} / ${_results.length}</div>
      <div class="score-rate">정답률 ${rate}%</div>
    </div>
    ${failed
      ? `<div class="result-section">
           <h3>다시 학습할 단어 ${failed}개</h3>
           <ul class="result-wrong-list">${wrongList}</ul>
         </div>`
      : `<div class="result-section perfect">완벽해요! 모두 통과했어요 🎉</div>`
    }
    <div class="result-actions">
      <a class="quiz-btn secondary" href="root.html?id=${encodeURIComponent(rootId)}">
        ← 어원 페이지로
      </a>
      <button class="quiz-btn" id="retryBtn">다시 풀기</button>
    </div>
  `;
  document.getElementById("retryBtn").addEventListener("click", () => {
    location.reload();
  });
}

/* ---------- 이벤트 ---------- */
function bind() {
  $choices.addEventListener("click", (e) => {
    const btn = e.target.closest(".quiz-choice");
    if (btn) handleAnswer(btn);
  });
  $nextBtn.addEventListener("click", () => {
    _idx++;
    if (_idx >= _allWords.length) {
      finish();
    } else {
      renderQuestion();
    }
  });
  // 숫자 키 1~4로 답 선택 (태블릿 키보드 사용자 편의)
  document.addEventListener("keydown", (e) => {
    if (_result && !$result.hidden) return;
    if (/^[1-4]$/.test(e.key)) {
      const i = parseInt(e.key, 10) - 1;
      const btn = $choices.querySelectorAll(".quiz-choice")[i];
      if (btn && !btn.disabled) handleAnswer(btn);
    } else if (e.key === "Enter" && !$nextBtn.hidden) {
      $nextBtn.click();
    }
  });
}

let _wordsIndex = [];

async function main() {
  if (!rootId) {
    $loading.textContent = "어원이 지정되지 않았어요.";
    return;
  }
  try {
    const [root, words] = await Promise.all([
      loadRoot(rootId),
      loadWordIndex(),
    ]);
    _wordsIndex = words;
    _pool = flattenRoot(root);
    if (!_pool.length) {
      $loading.textContent = "이 어원에 단어가 없어요.";
      return;
    }
    _allWords = shuffle(_pool);  // 모든 단어를 무작위 순서로 출제
    $loading.style.display = "none";
    $title.textContent = `퀴즈 — ${root.rootForm} (${root.meaning})`;
    document.title = `퀴즈 ${root.rootForm}`;
    bind();
    renderQuestion();
  } catch (err) {
    $loading.textContent = "퀴즈를 불러오지 못했어요.";
    console.error(err);
  }
}

main();
