/* ============================================================
 * data-loader.js — 어원 데이터와 학습 진도를 다루는 유틸 모음
 * ------------------------------------------------------------
 *   - 데이터 로드는 fetch + 캐시 (한 번 받으면 메모리에 보관)
 *   - 진도는 localStorage에 단순 JSON 형태로 저장
 *   - 같은 기기 같은 브라우저에서만 유지된다는 점 명심
 * ============================================================ */

const PROGRESS_KEY = "vocab-roots-progress-v1";

// 메모리 캐시 — 같은 페이지 안에서 같은 어원을 또 받지 않도록
const _rootCache = new Map();
let _indexCache = null;
let _prefixCache = null;
let _wordsCache = null;

/**
 * 어원 목록(인덱스) 로드
 * data/roots.json — 어원 카드 한 줄짜리 메타 배열
 */
export async function loadRootIndex() {
  if (_indexCache) return _indexCache;
  const res = await fetch("./data/roots.json");
  if (!res.ok) throw new Error("어원 목록을 불러오지 못했습니다");
  _indexCache = await res.json();
  return _indexCache;
}

/**
 * 어원 한 개 상세 로드
 * @param {string} id 어원 id (예 "spec")
 */
export async function loadRoot(id) {
  if (_rootCache.has(id)) return _rootCache.get(id);
  const res = await fetch(`./data/roots/${id}.json`);
  if (!res.ok) throw new Error(`어원 데이터를 찾을 수 없습니다 — ${id}`);
  const data = await res.json();
  _rootCache.set(id, data);
  return data;
}

/**
 * 접두어 인덱스 로드 — data/prefixes.json
 * (sync_index.py가 모든 어원 파일에서 자동으로 모아 생성)
 */
export async function loadPrefixIndex() {
  if (_prefixCache) return _prefixCache;
  const res = await fetch("./data/prefixes.json");
  if (!res.ok) throw new Error("접두어 목록을 불러오지 못했습니다");
  _prefixCache = await res.json();
  return _prefixCache;
}

/** 단일 접두어 상세 조회 — 인덱스에서 id로 찾는다 */
export async function loadPrefix(id) {
  const all = await loadPrefixIndex();
  const found = (all.prefixes || []).find((p) => p.id === id);
  if (!found) throw new Error(`접두어를 찾을 수 없습니다 — ${id}`);
  return found;
}

/** 전체 단어 인덱스 로드 — 검색·퀴즈 출제용 */
export async function loadWordIndex() {
  if (_wordsCache) return _wordsCache;
  const res = await fetch("./data/words.json");
  if (!res.ok) throw new Error("단어 인덱스를 불러오지 못했습니다");
  _wordsCache = await res.json();
  return _wordsCache;
}

/** 유의어/반의어 사전 — words.json에 없는 단어들의 IPA·뜻
 * 키는 소문자 단어 또는 구문, 값 = { ipa, meaning }. 없으면 빈 객체. */
let _glossaryCache = null;
export async function loadGlossary() {
  if (_glossaryCache) return _glossaryCache;
  try {
    const res = await fetch("./data/glossary.json");
    if (!res.ok) {
      _glossaryCache = {};
      return _glossaryCache;
    }
    _glossaryCache = await res.json();
  } catch {
    _glossaryCache = {};
  }
  return _glossaryCache;
}

/** 역방향 매핑 — 유의어/반의어로 등장하는 단어가 어디서 나오는지
 * { "incredible": [{root, rootForm, word, prefix, role}, …] } */
let _relatedCache = null;
export async function loadRelated() {
  if (_relatedCache) return _relatedCache;
  try {
    const res = await fetch("./data/related.json");
    _relatedCache = res.ok ? await res.json() : {};
  } catch {
    _relatedCache = {};
  }
  return _relatedCache;
}

/** 통합 단어 조회 — 우리 단어 인덱스 우선, 없으면 사전.
 * 반환 — { ipa, meaning, root?, rootForm? } 또는 null */
export async function lookupWord(word) {
  if (!word) return null;
  const key = word.toLowerCase().trim();
  const [words, glossary] = await Promise.all([loadWordIndex(), loadGlossary()]);
  // 1순위 — 자체 단어 인덱스 (어원 정보까지 포함)
  for (const w of words) {
    if (w.w.toLowerCase() === key) {
      return {
        ipa: w.p || "",
        meaning: w.m || "",
        root: w.root,
        rootForm: w.rootForm,
        prefix: w.prefix,
      };
    }
  }
  // 2순위 — 사전
  const g = glossary[key];
  if (g) return { ipa: g.ipa || "", meaning: g.meaning || "" };
  return null;
}

/* ---------- 진도(localStorage) ---------- */

function _readProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return _defaultProgress();
    const p = JSON.parse(raw);
    // 누락 필드 보정 (구버전 데이터 호환)
    p.completedRoots = p.completedRoots || [];
    p.wordResults = p.wordResults || {};
    return p;
  } catch (e) {
    console.warn("진도 데이터가 손상되어 초기화합니다", e);
    return _defaultProgress();
  }
}

function _defaultProgress() {
  return {
    completedRoots: [],
    lastVisited: null,
    wordBookmarks: [],
    // 단어 → "passed" | "failed" (퀴즈 결과)
    wordResults: {},
  };
}

function _writeProgress(progress) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

export function getProgress() {
  return _readProgress();
}

export function isRootDone(id) {
  return _readProgress().completedRoots.includes(id);
}

/** 어원 완료 토글 — 이미 완료면 해제, 아니면 추가 */
export function toggleRootDone(id) {
  const p = _readProgress();
  const idx = p.completedRoots.indexOf(id);
  if (idx === -1) {
    p.completedRoots.push(id);
  } else {
    p.completedRoots.splice(idx, 1);
  }
  _writeProgress(p);
  return idx === -1; // 토글 후 상태 — true면 이제 완료됨
}

export function setLastVisited(id) {
  const p = _readProgress();
  p.lastVisited = id;
  _writeProgress(p);
}

/** 진도 전체 초기화 — 설정에서 사용 */
export function resetProgress() {
  localStorage.removeItem(PROGRESS_KEY);
}

/* ============================================================
 * 서비스 워커 등록 + 자동 갱신
 * ------------------------------------------------------------
 * 모든 진입 페이지에서 한 번씩 호출.
 * 캐시 버전이 바뀌면 새 SW가 받아져 자동 활성화되고
 * 그 즉시 페이지를 한 번 reload해 깨끗한 새 캐시로 전환한다.
 * 무한 reload 방지 — sessionStorage 플래그로 한 번만.
 * ============================================================ */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return;

  navigator.serviceWorker
    .register("./service-worker.js")
    .then((reg) => {
      // 매 진입마다 명시적으로 업데이트 확인
      reg.update().catch(() => {});

      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "activated" && !sessionStorage.getItem("sw-reloaded")) {
            sessionStorage.setItem("sw-reloaded", "1");
            location.reload();
          }
        });
      });
    })
    .catch((err) => console.warn("SW 등록 실패", err));

  // 다른 탭에서 새 SW로 바뀐 경우에도 한 번만 reload
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    sessionStorage.setItem("sw-reloaded", "1");
    location.reload();
  });
}

/* ---------- 단어별 퀴즈 결과 ---------- */

/** 단어의 현재 상태 — "passed" | "failed" | "" */
export function getWordStat(word) {
  if (!word) return "";
  return _readProgress().wordResults[word.toLowerCase()] || "";
}

/** 퀴즈 결과를 한 단어에 기록 (passed/failed) */
export function setWordStat(word, status) {
  if (!word) return;
  const p = _readProgress();
  const key = word.toLowerCase();
  if (status === "passed" || status === "failed") {
    p.wordResults[key] = status;
  } else {
    delete p.wordResults[key];
  }
  _writeProgress(p);
}

/** 여러 단어 결과를 한 번에 — 퀴즈 끝났을 때 호출 */
export function setWordStats(entries) {
  // entries — [{word, status}, ...]
  const p = _readProgress();
  for (const { word, status } of entries) {
    if (!word) continue;
    const key = word.toLowerCase();
    if (status === "passed" || status === "failed") {
      p.wordResults[key] = status;
    } else {
      delete p.wordResults[key];
    }
  }
  _writeProgress(p);
}

/** 한 어원 내 단어들의 통과 수 — 진도 표시용 */
export function rootProgress(root) {
  const p = _readProgress();
  let passed = 0, failed = 0, total = 0;
  for (const sec of root.tree || []) {
    for (const w of sec.words || []) {
      total++;
      const s = p.wordResults[w.word.toLowerCase()];
      if (s === "passed") passed++;
      else if (s === "failed") failed++;
    }
  }
  return { passed, failed, total };
}
