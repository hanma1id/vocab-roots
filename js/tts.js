/* ============================================================
 * tts.js — Web Speech API 발음 재생 모듈
 * ------------------------------------------------------------
 *   - 외부 의존성 없음. 대부분 브라우저/OS 내장 음성을 사용한다.
 *   - iOS Safari는 사용자가 한 번 화면을 탭한 뒤에야 음성을 낸다
 *     (자동재생 제한). 첫 탭 이후로는 자유롭게 재생 가능.
 *   - 사용 가능한 영어 음성이 있으면 우선 선택한다.
 * ============================================================ */

let _voicesLoaded = false;
let _enVoice = null;

/** 사용 가능한 음성 목록에서 영어 음성을 골라 캐시한다. */
function pickEnglishVoice() {
  const voices = window.speechSynthesis.getVoices();
  if (!voices || !voices.length) return null;
  // 영국/미국 영어를 우선 — 학습용으로는 둘 다 무방
  const preferred = voices.find((v) =>
    /en[-_](us|gb)/i.test(v.lang)
  );
  return preferred || voices.find((v) => v.lang.startsWith("en")) || voices[0];
}

/** 음성 목록은 비동기로 로드되는 브라우저가 있어 콜백으로 기다린다. */
function ensureVoiceReady() {
  return new Promise((resolve) => {
    if (_voicesLoaded && _enVoice) return resolve(_enVoice);

    const tryPick = () => {
      _enVoice = pickEnglishVoice();
      if (_enVoice) {
        _voicesLoaded = true;
        resolve(_enVoice);
        return true;
      }
      return false;
    };

    if (tryPick()) return;

    // 음성 목록이 비어 있으면 voiceschanged 이벤트를 기다린다
    window.speechSynthesis.onvoiceschanged = () => {
      tryPick();
      // 끝까지 못 고르면 그냥 null로 진행 (기본 음성 사용)
      resolve(_enVoice);
    };

    // 안전망 — 일부 환경에선 이벤트가 안 오므로 800ms 후 강제 진행
    setTimeout(() => resolve(_enVoice), 800);
  });
}

/**
 * 단어를 영어 발음으로 재생
 * @param {string} word 재생할 영어 단어
 */
export async function speak(word) {
  if (!("speechSynthesis" in window)) {
    console.warn("이 브라우저는 음성 합성을 지원하지 않습니다");
    return;
  }

  // 이전에 재생 중이던 음성이 있다면 끊고 새 단어 재생
  window.speechSynthesis.cancel();

  const voice = await ensureVoiceReady();
  const utter = new SpeechSynthesisUtterance(word);
  utter.lang = voice ? voice.lang : "en-US";
  if (voice) utter.voice = voice;
  utter.rate = 0.9;   // 학습용으로 조금 느리게
  utter.pitch = 1.0;
  window.speechSynthesis.speak(utter);
}
