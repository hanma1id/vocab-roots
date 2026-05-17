/* ============================================================
 * map-page.js — 의미 클러스터 지도 (map.html)
 * ------------------------------------------------------------
 *   - roots.json에서 cluster 필드로 그룹화
 *   - 클러스터별로 색을 부여 (CSS 변수로)
 *   - 어원 카드 탭하면 어원 상세로 이동
 * ============================================================ */

import { loadRootIndex, registerServiceWorker } from "./data-loader.js";

registerServiceWorker();

const $area    = document.getElementById("mapArea");
const $loading = document.getElementById("loading");

// 클러스터 → 팔레트 인덱스 (CSS에서 --cluster-N으로 받음)
// 등장 순서로 자동 할당하되 색이 너무 비슷하지 않게.
const PALETTE_SIZE = 10;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function groupByCluster(roots) {
  const map = new Map();
  for (const r of roots) {
    const key = r.cluster || "기타";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  // 어원이 많은 클러스터를 위로
  return [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length);
}

function renderCluster([name, roots], idx) {
  const colorIdx = idx % PALETTE_SIZE;
  const cards = roots.map((r) => `
    <a class="map-card" href="root.html?id=${encodeURIComponent(r.id)}">
      <div class="map-card-form">${esc(r.rootForm)}</div>
      <div class="map-card-meaning">${esc(r.meaning)}</div>
      <div class="map-card-meta">단어 ${r.wordCount ?? "?"}개</div>
    </a>
  `).join("");

  return `
    <section class="cluster-section" style="--cluster-color: var(--cluster-${colorIdx});">
      <header class="cluster-header">
        <span class="cluster-dot"></span>
        <h2 class="cluster-title">${esc(name)}</h2>
        <span class="cluster-count">어원 ${roots.length}개</span>
      </header>
      <div class="map-grid">${cards}</div>
    </section>
  `;
}

async function main() {
  try {
    const roots = await loadRootIndex();
    $loading.style.display = "none";
    const groups = groupByCluster(roots);
    $area.innerHTML = groups.map(renderCluster).join("");
  } catch (err) {
    $loading.textContent = "지도 데이터를 불러오지 못했어요.";
    console.error(err);
  }
}

main();
