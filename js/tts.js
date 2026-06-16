/* ============================================================
 * tts.js — Web Speech API 발음 재생 모듈 (모바일 견고 버전)
 * ------------------------------------------------------------
 *  모바일 함정 모음
 *   1. speak()는 동기 — async/await 끼면 iOS가 제스처로 인정 X
 *   2. iOS는 첫 speak 호출 시 voice 목록이 비어 있을 수 있음
 *      → 사용자 탭 안에서 getVoices()를 다시 호출하면 채워지는 경우 多
 *   3. 잘못된 voice (예 ko-KR)로 영어 단어 재생하면 침묵하거나 이상함
 *      → 영어 voice 못 찾으면 lang만 'en-US' 지정하고 voice는 비움
 *   4. speak 직전 cancel()이 iOS에서 새 발화를 함께 죽이는 사례 있음
 *      → 이전 발화가 실제 진행 중일 때만 cancel
 *   5. PWA standalone 모드에서는 speechSynthesis가 가끔 paused 상태로 멈춤
 *      → resume() 시도
 *   6. iOS 무음 스위치(벨소리 모드)는 TTS도 막을 수 있음 (사용자 측 OS 설정)
 *
 *  디버그 — 콘솔에 [tts] 로 시작하는 로그를 남겨 PC 원격으로도 추적 가능
 * ============================================================ */

const DEBUG = true;
const log = (...a) => DEBUG && console.log("[tts]", ...a);

let _enVoice = null;

/** voice 목록에서 영어 voice를 골라 캐시. 동기 함수. */
function pickEnglishVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || !voices.length) return null;
  // 미국 영어 > 영국 영어 > 그 외 영어 순
  const prefer =
    voices.find((v) => /en[-_]us/i.test(v.lang)) ||
    voices.find((v) => /en[-_]gb/i.test(v.lang)) ||
    voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("en"));
  if (prefer) {
    log("voice picked:", prefer.name, prefer.lang);
    return prefer;
  }
  log("no english voice in", voices.length, "voices");
  return null;
}

// 모듈 로드 시 미리 시도
if ("speechSynthesis" in window) {
  _enVoice = pickEnglishVoice();
  // voice 목록이 늦게 채워지는 브라우저 대비
  window.speechSynthesis.onvoiceschanged = () => {
    if (!_enVoice) _enVoice = pickEnglishVoice();
  };
} else {
  log("speechSynthesis not supported");
}

/**
 * 단어 발음 재생. 반드시 동기 — 탭 핸들러에서 직접 호출.
 * @param {string} word
 */
export function speak(word) {
  if (!("speechSynthesis" in window)) {
    alert("이 브라우저는 음성 합성을 지원하지 않습니다");
    return;
  }
  if (!word) return;

  const synth = window.speechSynthesis;
  log("speak start:", word, "speaking?", synth.speaking, "paused?", synth.paused);

  // user gesture 시점에 voice 한 번 더 갱신 시도 (iOS에서 이때 채워지는 경우)
  if (!_enVoice) {
    _enVoice = pickEnglishVoice();
  }

  // 정말 발화 중일 때만 끊는다 — 빈 호출에선 cancel 안 함
  if (synth.speaking || synth.pending) {
    try { synth.cancel(); } catch (e) { log("cancel err", e); }
  }
  // 일시정지 상태 깨우기 (iOS PWA에서 가끔 paused)
  if (synth.paused) {
    try { synth.resume(); } catch (e) { log("resume err", e); }
  }

  const utter = new SpeechSynthesisUtterance(word);
  if (_enVoice) {
    utter.voice = _enVoice;
    utter.lang = _enVoice.lang;
  } else {
    // 영어 voice 못 찾으면 lang만 지정 — 브라우저가 알아서 영어로
    utter.lang = "en-US";
  }
  utter.rate = 0.9;
  utter.pitch = 1.0;
  utter.volume = 1.0;

  // 이벤트로 실제 동작 추적 — 디버그용
  utter.onstart = () => log("onstart:", word);
  utter.onend = () => log("onend:", word);
  utter.onerror = (e) => log("onerror:", word, e.error || e);

  try {
    synth.speak(utter);
    log("speak() called, queue len:", synth.pending ? "pending" : "ok");
  } catch (e) {
    log("speak threw", e);
  }
}

/* ----- iOS 잠금 해제 -----
 * 페이지의 첫 사용자 탭에서 무음 발화로 speechSynthesis를 "활성화"한다.
 * 한 번만 실행. */
let _unlocked = false;
function unlockOnce() {
  if (_unlocked || !("speechSynthesis" in window)) return;
  _unlocked = true;
  try {
    const u = new SpeechSynthesisUtterance(" ");  // 짧은 silent
    u.volume = 0;
    u.rate = 1;
    window.speechSynthesis.speak(u);
    log("unlock fired");
  } catch (e) {
    log("unlock err", e);
  }
}

if (typeof document !== "undefined") {
  // pointerdown은 click보다 빠르고 첫 제스처에 잘 잡힘
  document.addEventListener("pointerdown", unlockOnce, { once: true, passive: true });
  document.addEventListener("touchstart", unlockOnce, { once: true, passive: true });
  document.addEventListener("click", unlockOnce, { once: true });
}
