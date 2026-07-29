// 플래시카드 학습 세션(뒤집기/평가/재등장 큐잉)
import { root } from "./dom.js?v=1";
import { escapeHtml, freqBadge } from "./utils.js?v=1";
import { showConfirm, toast } from "./ui.js?v=1";
import { state, getRecord, ensureRecord } from "./state.js?v=1";
import * as SRS from "./srs.js";
import * as Storage from "./storage.js";
import { syncPush } from "./sync-bridge.js?v=1";
import { speak } from "./tts.js?v=1";
import { renderHome, renderGlossedSentence } from "./views.js?v=1";

export function startSession(words) {
  if (!words.length) {
    toast("학습할 단어가 없습니다.");
    return;
  }
  state.currentSession = {
    queue: words.slice(),
    index: 0,
    flipped: false,
    stats: { reviewed: 0, again: 0 },
  };
  renderStudy();
}

function renderStudy() {
  const s = state.currentSession;
  if (!s || s.index >= s.queue.length) {
    renderSessionSummary();
    return;
  }
  const word = s.queue[s.index];
  const rec = getRecord(word.id);
  const isNew = !rec;

  const derivHtml = (word.derivatives || [])
    .map((d) => `<span class="deriv-chip">${escapeHtml(d.form)} <i>(${escapeHtml(d.pos)})</i></span>`)
    .join("");
  const collocHtml = (word.collocations || [])
    .map((c) => `<span class="colloc-chip">${escapeHtml(c)}</span>`)
    .join("");
  const noteHtml = word.note
    ? `<div class="word-note">⚠️ ${escapeHtml(word.note)}</div>`
    : "";

  root.innerHTML = `
    <div class="topbar">
      <button class="back-btn" id="btn-exit">✕ 종료</button>
      <div class="study-progress">${s.index + 1} / ${s.queue.length}</div>
      <div></div>
    </div>
    <div class="study-progress-bar"><div class="study-progress-fill" style="width:${
      (s.index / s.queue.length) * 100
    }%"></div></div>
    <div class="card-wrap">
      <div class="flashcard ${s.flipped ? "flipped" : ""}" id="flashcard">
        <div class="card-face card-front">
          <span class="new-badge" style="visibility:${isNew ? "visible" : "hidden"}">NEW</span>
          <div class="card-freq">${freqBadge(word)}</div>
          <div class="word-headword">${escapeHtml(word.headword)}</div>
          <div class="word-ipa">${escapeHtml(word.ipa || "")}</div>
          <div class="word-pos-badge">${escapeHtml(word.pos)}</div>
          <button class="speak-btn" id="btn-speak-front">🔊 발음 듣기</button>
          <div class="flip-hint">탭하여 뜻 보기</div>
        </div>
        <div class="card-face card-back">
          <div class="word-headword small">${escapeHtml(word.headword)} <button class="speak-btn-inline" id="btn-speak-back">🔊</button></div>
          <div class="word-meaning-big">${escapeHtml(word.meaning_kr)}</div>
          <div class="example-en">${renderGlossedSentence(word.example_en)}</div>
          <div class="example-kr">${escapeHtml(word.example_kr)}</div>
          ${derivHtml ? `<div class="deriv-row">${derivHtml}</div>` : ""}
          ${collocHtml ? `<div class="colloc-row">${collocHtml}</div>` : ""}
          ${noteHtml}
        </div>
      </div>
    </div>
    <div class="rate-row" style="visibility:${s.flipped ? "visible" : "hidden"}">
      <button class="rate-btn rate-again" data-q="0">다시<br><small>매우 자주 등장</small></button>
      <button class="rate-btn rate-hard" data-q="3">어려움<br><small>자주 등장</small></button>
      <button class="rate-btn rate-good" data-q="4">좋음<br><small>가끔 등장</small></button>
      <button class="rate-btn rate-easy" data-q="5">쉬움<br><small>거의 등장 안 함</small></button>
    </div>
  `;

  document.getElementById("btn-exit").addEventListener("click", () => {
    showConfirm("학습을 종료하시겠습니까? 지금까지의 진행은 저장됩니다.", renderHome);
  });

  const flip = () => {
    if (state.currentSession.flipped) return;
    state.currentSession.flipped = true;
    renderStudy();
  };

  document.getElementById("flashcard").addEventListener("click", flip);
  document.getElementById("btn-speak-front").addEventListener("click", (e) => {
    e.stopPropagation();
    speak(word.headword);
  });
  const backSpeak = document.getElementById("btn-speak-back");
  if (backSpeak) {
    backSpeak.addEventListener("click", (e) => {
      e.stopPropagation();
      speak(word.headword);
    });
  }

  if (s.flipped) {
    root.querySelectorAll(".rate-btn").forEach((btn) => {
      btn.addEventListener("click", () => rateWord(Number(btn.dataset.q)));
    });
  }
}

function rateWord(quality) {
  const s = state.currentSession;
  const word = s.queue[s.index];
  const rec = ensureRecord(word.id);
  state.SRS_STATE[word.id] = SRS.review(rec, quality);
  Storage.saveSrsState(state.SRS_STATE);
  Storage.incrementTodayReviewed();
  state.STREAK = Storage.loadStreak();
  syncPush();

  s.stats.reviewed++;
  if (quality < 3) {
    s.stats.again++;
    const reinsertAt = Math.min(s.index + 4, s.queue.length);
    s.queue.splice(reinsertAt, 0, word);
  }

  s.index++;
  s.flipped = false;
  renderStudy();
}

function renderSessionSummary() {
  const s = state.currentSession;
  root.innerHTML = `
    <div class="summary-wrap">
      <div class="summary-emoji">🎉</div>
      <div class="summary-title">학습 완료!</div>
      <div class="summary-desc">${s.stats.reviewed}개 카드 학습 (다시 ${s.stats.again}회)</div>
      <button class="btn btn-primary" id="btn-summary-home">홈으로</button>
    </div>
  `;
  document.getElementById("btn-summary-home").addEventListener("click", renderHome);
}
