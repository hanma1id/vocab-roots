/* ============================================================
 * service-worker.js — 어원 학습 PWA의 오프라인 캐시 담당
 * ------------------------------------------------------------
 * 목적
 *   - 첫 방문 때 핵심 정적 파일과 어원 데이터를 모두 캐시한다.
 *   - 이후엔 네트워크가 끊겨도 동일하게 동작한다.
 *
 * 사용 방법
 *   - 어원 JSON을 추가하면 아래 CACHE_VERSION 값을 +1 하거나
 *     날짜 문자열을 갱신해 새 캐시가 만들어지도록 한다.
 *   - 그러면 다음 새로고침 때 옛 캐시는 자동 삭제된다.
 * ============================================================ */

const CACHE_VERSION = "vocab-roots-v30-2026-05-21";

// 미리 캐시할 핵심 자원 목록
// (어원 JSON은 동적으로 늘어나므로 fetch 시점에 캐시한다)
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./root.html",
  "./prefix.html",
  "./map.html",
  "./quiz.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/root-page.js",
  "./js/prefix-page.js",
  "./js/map-page.js",
  "./js/quiz-page.js",
  "./js/data-loader.js",
  "./js/tts.js",
  "./data/roots.json",
  "./data/prefixes.json",
  "./data/words.json",
  "./data/glossary.json",
  "./data/related.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// 설치 단계 — 핵심 파일을 한 번에 캐시한다.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // 일부 파일이 없어도 설치 자체가 깨지지 않도록 개별 add 사용
      return Promise.all(
        CORE_ASSETS.map((url) =>
          cache.add(url).catch((err) =>
            console.warn("[SW] 캐시 실패 —", url, err)
          )
        )
      );
    })
  );
  // 새 SW를 즉시 활성화 (사용자가 새로고침 한 번에 최신 버전을 보도록)
  self.skipWaiting();
});

// 활성화 단계 — 이전 버전 캐시를 정리한다.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  // 열린 탭들에 새 SW를 바로 적용
  self.clients.claim();
});

/* fetch 전략 — "네트워크 우선, 실패 시 캐시"
 *   - 항상 최신 파일을 받으려 한다. CSS·JS 변경이 즉시 반영됨.
 *   - 네트워크가 끊겼거나 느리면 캐시로 폴백 → 오프라인 동작 보장.
 *   - 응답은 다음을 위해 항상 캐시에 갱신해 둔다.
 */
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 정상 응답이면 캐시 갱신
        if (response && response.status === 200 && response.type === "basic") {
          const cloned = response.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(event.request, cloned);
          });
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(
          (cached) => cached || new Response("", { status: 504, statusText: "오프라인" })
        )
      )
  );
});
