// 음성 합성(TTS) 및 듣기 모드(화면 없이 연속 재생)
import { escapeHtml, freqBadge, shuffleArray } from "./utils.js?v=1";
import { root } from "./dom.js?v=1";
import { toast } from "./ui.js?v=1";
import { renderHome } from "./views.js?v=3";
import { loadListenProgress, saveListenProgress, clearListenProgress } from "./storage.js?v=1";

let VOICES = [];
function loadVoices() {
  VOICES = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
}
if ("speechSynthesis" in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function pickVoice(langPrefix) {
  const candidates = VOICES.filter(
    (v) => v.lang && v.lang.toLowerCase().startsWith(langPrefix.toLowerCase())
  );
  if (!candidates.length) return null;
  // 토익 리스닝처럼 또렷하고 자연스러운 음성을 우선 선택
  // (Google/Microsoft의 고품질 온라인 음성 > 신경망 음성 > 일반 로컬 음성 순)
  const preferredPatterns = [
    /google/i,
    /online.*natural/i,
    /natural/i,
    /\b(aria|guy|jenny|jane|libby|ryan|sonia)\b/i,
  ];
  for (const pattern of preferredPatterns) {
    const match = candidates.find((v) => pattern.test(v.name));
    if (match) return match;
  }
  return candidates[0];
}

function makeUtterance(text, lang, rate) {
  const u = new SpeechSynthesisUtterance(text || "");
  u.lang = lang;
  const voice = pickVoice(lang.split("-")[0]);
  if (voice) u.voice = voice;
  u.rate = rate || 0.95;
  return u;
}

export function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const utter = makeUtterance(text, "en-US", 0.95);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

let LISTEN = null; // { words, originalWords, index, playing, loop, shuffled, finished, chapterId }

export function isListening() {
  return !!LISTEN;
}

// ---- 백그라운드 재생 유지 ----
// 휴대폰 브라우저는 speechSynthesis를 "미디어 재생"으로 쳐주지 않아서, 앱이 화면
// 뒤로 가거나(네비 앱 등) 화면이 꺼지면 음성을 멈춥니다. 그래서 들리지 않을 만큼
// 작은 소리를 반복 재생하는 <audio>를 함께 틀어 브라우저가 이 페이지를 음악 앱처럼
// "재생 중"으로 보게 하고, MediaSession으로 잠금화면/알림창 컨트롤도 연결합니다.
// 그래도 음성이 끊기면 앱으로 돌아왔을 때(또는 몇 초 이상 멈춰 있으면) 현재 단어부터 다시 재생합니다.
let keepAliveAudio = null;
let watchdogTimer = null;

function buildSilentWavUrl() {
  const rate = 8000;
  const samples = rate * 2;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const writeStr = (offset, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples * 2, true);
  // 완전한 무음은 "재생 중"으로 인정받지 못하는 기기가 있어, 거의 안 들리는 아주 작은 저주파를 넣습니다.
  for (let i = 0; i < samples; i++) {
    view.setInt16(44 + i * 2, Math.round(Math.sin((i / rate) * 2 * Math.PI * 30) * 6), true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

function startKeepAlive() {
  try {
    if (!keepAliveAudio) {
      keepAliveAudio = new Audio(buildSilentWavUrl());
      keepAliveAudio.loop = true;
    }
    keepAliveAudio.play().catch(() => {});
  } catch (_) {
    // 오디오를 못 만들어도 기본 듣기 기능은 그대로 동작합니다.
  }
  if (!watchdogTimer) {
    watchdogTimer = setInterval(checkStalled, 3000);
  }
  setupMediaSession();
}

function stopKeepAlive() {
  if (keepAliveAudio) keepAliveAudio.pause();
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = "none";
    navigator.mediaSession.metadata = null;
  }
}

function setupMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const handlers = {
    play: () => resumeListening(),
    pause: () => pauseListening(),
    nexttrack: () => nextListening(),
    previoustrack: () => prevListening(),
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try {
      navigator.mediaSession.setActionHandler(action, fn);
    } catch (_) {}
  }
}

function updateMediaSession(word) {
  if (!("mediaSession" in navigator) || !word) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: word.headword,
      artist: word.meaning_kr || "",
      album: "토익 900 단어장",
    });
    navigator.mediaSession.playbackState = LISTEN && LISTEN.playing ? "playing" : "paused";
  } catch (_) {}
}

// 음성이 조용히 멈춰버린 경우(백그라운드에서 브라우저가 중단시킨 경우 등)
// 멈춘 바로 그 구간부터 다시 시작합니다.
const STALL_MS = 5000; // 말하고 있지 않은데 이만큼 진행이 없으면 멈춘 것으로 봄
const HARD_STALL_MS = 45000; // "말하는 중"이라고 하는데도 이만큼 진행이 없으면 걸린 것으로 봄
function checkStalled() {
  if (!LISTEN || !LISTEN.playing || LISTEN.finished || !LISTEN.cur) return;
  const synth = window.speechSynthesis;
  if (keepAliveAudio && keepAliveAudio.paused) keepAliveAudio.play().catch(() => {});
  if (synth.paused) synth.resume();
  const idleMs = Date.now() - LISTEN.lastProgress;
  const stuck = synth.speaking ? idleMs > HARD_STALL_MS : idleMs > STALL_MS;
  if (stuck) restartCurrentStep();
}

function restartCurrentStep() {
  if (!LISTEN || !LISTEN.cur) return;
  const { wordIdx, step } = LISTEN.cur;
  LISTEN.gen += 1;
  window.speechSynthesis.cancel();
  runStep(wordIdx, step, LISTEN.gen);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkStalled();
});

function buildSteps(w) {
  const meaning = (w.meaning_kr || "").split(/[;,]/)[0].trim();
  return [
    [w.headword, "en-US", 0.95],
    [meaning, "ko-KR", 1],
    [w.headword, "en-US", 0.95],
    [meaning, "ko-KR", 1],
    [w.example_en, "en-US", 0.92],
    [w.example_kr, "ko-KR", 1],
    [w.example_en, "en-US", 0.92],
    [w.example_kr, "ko-KR", 1],
  ];
}

// chapterId가 있으면 이전에 듣다가 중단한 지점부터 이어서 재생합니다.
// (실수로 다른 화면으로 넘어가도 진도가 저장되어 있어 처음부터 다시 듣지 않아도 됩니다)
export function startListening(words, loop, chapterId) {
  if (!words.length) {
    toast("들을 단어가 없습니다.");
    return;
  }
  if (!("speechSynthesis" in window)) {
    toast("이 브라우저는 음성 재생을 지원하지 않습니다.");
    return;
  }
  LISTEN = {
    words: words.slice(),
    originalWords: words.slice(),
    index: 0,
    playing: true,
    loop: !!loop,
    shuffled: false,
    finished: false,
    chapterId: chapterId || null,
  };
  const savedIndex = loadListenProgress(chapterId);
  const startIndex = savedIndex > 0 && savedIndex < words.length ? savedIndex : 0;
  if (startIndex > 0) toast(`이전에 듣던 ${startIndex + 1}번째 단어부터 이어서 재생합니다.`);
  startKeepAlive(); // 버튼 클릭 직후에 시작해야 브라우저가 오디오 재생을 허용합니다
  playListenFrom(startIndex);
}

// 저장된 진도를 무시하고 처음부터 새로 듣기 시작합니다.
export function startListeningFromBeginning(words, loop, chapterId) {
  clearListenProgress(chapterId);
  startListening(words, loop, chapterId);
}

function setShuffleListening(on) {
  if (!LISTEN) return;
  LISTEN.shuffled = on;
  LISTEN.words = on ? shuffleArray(LISTEN.originalWords) : LISTEN.originalWords.slice();
  playListenFrom(0);
}

// 단어 하나(8개 구간)를 한꺼번에 큐에 넣지 않고, 구간 하나가 끝날 때마다 다음 구간을
// 직접 이어서 말합니다. 백그라운드에서는 브라우저가 큐에 쌓아둔 뒤쪽 구간을 말하지 않고
// 멈춰버리는 경우가 있어서(소리는 나는데 다음 단어로 안 넘어가는 증상), 매번 "방금 끝났으니
// 다음 거"를 새로 요청하는 방식이 더 안정적입니다.
function finishListenPass() {
  if (!LISTEN) return;
  if (LISTEN.loop) {
    playListenFrom(0);
    return;
  }
  LISTEN.playing = false;
  LISTEN.finished = true;
  clearListenProgress(LISTEN.chapterId);
  if (keepAliveAudio) keepAliveAudio.pause();
  renderListening();
}

function runStep(wordIdx, step, gen) {
  if (!LISTEN || LISTEN.gen !== gen) return;
  if (wordIdx >= LISTEN.words.length) {
    finishListenPass();
    return;
  }
  const steps = buildSteps(LISTEN.words[wordIdx]);
  if (step >= steps.length) {
    runStep(wordIdx + 1, 0, gen);
    return;
  }
  if (wordIdx !== LISTEN.index) {
    LISTEN.index = wordIdx;
    saveListenProgress(LISTEN.chapterId, wordIdx);
    renderListening();
  }
  const [text, lang, rate] = steps[step];
  if (!text) {
    runStep(wordIdx, step + 1, gen);
    return;
  }
  LISTEN.cur = { wordIdx, step };
  LISTEN.lastProgress = Date.now();

  const u = makeUtterance(text, lang, rate);
  let handled = false;
  const advance = (completed) => {
    if (handled) return;
    handled = true;
    if (!LISTEN || LISTEN.gen !== gen) return;
    LISTEN.lastProgress = Date.now();
    const nextStep = completed ? step + 1 : step;
    if (!LISTEN.playing) {
      // 일시정지 중에 끊긴 경우(일부 폰은 pause를 취소로 처리) - 재개할 때 여기서부터 이어서 말함
      LISTEN.resumeAt = { wordIdx, step: nextStep };
      return;
    }
    runStep(wordIdx, nextStep, gen);
  };
  u.onstart = () => {
    if (LISTEN && LISTEN.gen === gen) LISTEN.lastProgress = Date.now();
  };
  u.onend = () => advance(true);
  u.onerror = (e) => {
    // 우리가 직접 취소한 경우는 gen이 바뀌어 무시됨. 그 외 오류는 같은 구간을 한 번 더 시도
    advance(e && (e.error === "canceled" || e.error === "interrupted") ? false : true);
  };
  window.speechSynthesis.speak(u);
}

function playListenFrom(idx) {
  if (!LISTEN) return;
  LISTEN.gen = (LISTEN.gen || 0) + 1;
  LISTEN.resumeAt = null;
  window.speechSynthesis.cancel();
  if (idx >= LISTEN.words.length) {
    finishListenPass();
    return;
  }
  LISTEN.index = idx;
  LISTEN.playing = true;
  LISTEN.finished = false;
  if (keepAliveAudio && keepAliveAudio.paused) keepAliveAudio.play().catch(() => {});
  saveListenProgress(LISTEN.chapterId, idx);
  renderListening();
  runStep(idx, 0, LISTEN.gen);
}

function pauseListening() {
  if (!LISTEN) return;
  LISTEN.playing = false;
  window.speechSynthesis.pause();
  if (keepAliveAudio) keepAliveAudio.pause();
  renderListening();
}

function resumeListening() {
  if (!LISTEN) return;
  if (keepAliveAudio) keepAliveAudio.play().catch(() => {});
  LISTEN.playing = true;
  const synth = window.speechSynthesis;
  if (LISTEN.resumeAt) {
    const { wordIdx, step } = LISTEN.resumeAt;
    LISTEN.resumeAt = null;
    LISTEN.gen += 1;
    synth.cancel();
    renderListening();
    runStep(wordIdx, step, LISTEN.gen);
    return;
  }
  synth.resume();
  LISTEN.lastProgress = Date.now();
  renderListening();
}

function nextListening() {
  if (!LISTEN) return;
  const next = LISTEN.index + 1;
  if (next >= LISTEN.words.length) {
    toast("마지막 단어입니다.");
    return;
  }
  playListenFrom(next);
}

function prevListening() {
  if (!LISTEN) return;
  playListenFrom(Math.max(0, LISTEN.index - 1));
}

export function stopListening() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  LISTEN = null;
  stopKeepAlive();
}

function renderListening() {
  if (!LISTEN) return;
  const word = LISTEN.words[LISTEN.index];
  const statusText = LISTEN.finished
    ? "🎉 재생 완료"
    : LISTEN.playing
    ? "🔊 재생 중... (다른 앱으로 넘어가도 이어서 재생을 시도합니다)"
    : "⏸ 일시정지";
  updateMediaSession(word);

  root.innerHTML = `
    <div class="topbar">
      <button class="back-btn" id="btn-listen-exit">✕ 종료</button>
      <div class="study-progress">${LISTEN.index + 1} / ${LISTEN.words.length}</div>
      <div></div>
    </div>
    <div class="listen-wrap">
      <div>${freqBadge(word)}</div>
      <div class="listen-word">${escapeHtml(word.headword)}</div>
      <div class="listen-ipa">${escapeHtml(word.ipa || "")}</div>
      <div class="listen-meaning">${escapeHtml(word.meaning_kr)}</div>
      <div class="listen-example-en">${escapeHtml(word.example_en)}</div>
      <div class="listen-example-kr">${escapeHtml(word.example_kr)}</div>
      <div class="listen-status">${statusText}</div>
    </div>
    <div class="listen-controls">
      <button class="listen-btn" id="btn-listen-prev">⏮</button>
      <button class="listen-btn listen-btn-main" id="btn-listen-toggle">${LISTEN.playing ? "⏸" : "▶"}</button>
      <button class="listen-btn" id="btn-listen-next">⏭</button>
    </div>
    <div class="listen-loop-row">
      <label><input type="checkbox" id="chk-listen-loop" ${LISTEN.loop ? "checked" : ""}/> 반복 재생 (끝까지 들으면 처음부터 다시)</label>
    </div>
    <div class="listen-loop-row">
      <label><input type="checkbox" id="chk-listen-shuffle" ${LISTEN.shuffled ? "checked" : ""}/> 🔀 랜덤 순서로 재생</label>
    </div>
  `;

  document.getElementById("btn-listen-exit").addEventListener("click", () => {
    stopListening();
    renderHome();
  });
  document.getElementById("btn-listen-prev").addEventListener("click", prevListening);
  document.getElementById("btn-listen-next").addEventListener("click", nextListening);
  document.getElementById("btn-listen-toggle").addEventListener("click", () => {
    if (!LISTEN) return;
    if (LISTEN.finished) playListenFrom(0);
    else if (LISTEN.playing) pauseListening();
    else resumeListening();
  });
  document.getElementById("chk-listen-loop").addEventListener("change", (e) => {
    if (LISTEN) LISTEN.loop = e.target.checked;
  });
  document.getElementById("chk-listen-shuffle").addEventListener("change", (e) => {
    setShuffleListening(e.target.checked);
  });
}
