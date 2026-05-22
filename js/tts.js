/* ============================================================
 * tts.js — Web Speech API 발음 재생 모듈
 * ------------------------------------------------------------
 *   - 외부 의존성 없음. 브라우저/OS 내장 음성을 사용한다.
 *
 * 모바일(특히 iOS Safari) 핵심
 *   - speechSynthesis.speak()는 "사용자 탭 직후"에만 허용된다.
 *   - speak()가 async라 await로 음성 목록을 기다리면, 그 사이
 *     사용자 제스처 컨텍스트가 끊겨 iOS가 음성을 차단한다.
 *   - 따라서 speak()는 반드시 동기로, 탭 즉시 speak()를 호출한다.
 *   - 음성 목록은 모듈 로드 시 미리 받아 캐시해 둔다.
 *   - 첫 사용자 탭 때 한 번 warm-up 해 iOS의 잠금을 푼다.
 * ============================================================ */

let _enVoice = null;
let _unlocked = false;

/** 사용 가능한 음성에서 영어 음성을 골라 캐시 */
function loadVoices() {
  if (!("speechSynthesis" in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || !voices.length) return;
  _enVoice =
    voices.find((v) => /en[-_](us|gb)/i.test(v.lang)) ||
    voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("en")) ||
    null;
}

// 모듈 로드 시 음성 미리 캐싱 — getVoices가 처음엔 빌 수 있어 이벤트도 등록
if ("speechSynthesis" in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

/**
 * iOS 잠금 해제 — 첫 사용자 제스처에서 빈 발화를 한 번 흘려
 * 이후 speak()가 정상 동작하도록 한다. 동기 호출이어야 효과 있음.
 */
function unlockOnce() {
  if (_unlocked || !("speechSynthesis" in window)) return;
  _unlocked = true;
  try {
    const warm = new SpeechSynthesisUtterance("");
    warm.volume = 0; // 소리 없이
    window.speechSynthesis.speak(warm);
  } catch (_) {
    /* 무시 */
  }
}

/**
 * 단어를 영어 발음으로 재생 — 반드시 동기. 탭 핸들러에서 직접 호출.
 * @param {string} word
 */
export function speak(word) {
  if (!("speechSynthesis" in window)) {
    console.warn("이 브라우저는 음성 합성을 지원하지 않습니다");
    return;
  }
  const synth = window.speechSynthesis;

  // 음성이 아직 캐시 안 됐으면 한 번 더 시도 (동기)
  if (!_enVoice) loadVoices();

  // iOS가 일시정지 상태로 두는 경우가 있어 깨운다
  if (synth.paused) {
    try { synth.resume(); } catch (_) {}
  }
  // 이전 발화 정리
  try { synth.cancel(); } catch (_) {}

  const utter = new SpeechSynthesisUtterance(word);
  if (_enVoice) {
    utter.voice = _enVoice;
    utter.lang = _enVoice.lang;
  } else {
    utter.lang = "en-US";
  }
  utter.rate = 0.9;   // 학습용으로 조금 느리게
  utter.pitch = 1.0;
  utter.volume = 1.0;

  try {
    synth.speak(utter);
  } catch (e) {
    console.warn("발음 재생 실패", e);
  }
}

// 페이지의 첫 탭/클릭에서 iOS 잠금 해제 (한 번만)
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", unlockOnce, { once: true });
  document.addEventListener("touchstart", unlockOnce, { once: true });
}
