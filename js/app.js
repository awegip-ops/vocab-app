import * as SRS from "./srs.js";
import * as Storage from "./storage.js";
import * as Sync from "./sync.js?v=2";

const PART_SIZE = 100;

let META = null;
let BASE_WORDS = [];
let CUSTOM_WORDS = [];
let SRS_STATE = {};
let STREAK = null;
let GLOSSARY = {};
let HEADWORD_MAP = {};

let currentSession = null; // { queue: [word,...], index, flipped, stats:{reviewed,new} }
let currentLevelView = null; // { level, category }
let currentView = "home"; // "home" | "stats" | other (study/level views skip auto-refresh)
let syncStatus = { state: "idle", lastSyncedAt: null, error: null }; // state: idle|syncing|synced|error

const root = document.getElementById("app");

async function init() {
  const [wordsRes, metaRes, glossaryRes] = await Promise.all([
    fetch("data/words.json", { cache: "no-store" }),
    fetch("data/meta.json", { cache: "no-store" }),
    fetch("data/glossary.json", { cache: "no-store" }),
  ]);
  BASE_WORDS = await wordsRes.json();
  META = await metaRes.json();
  GLOSSARY = await glossaryRes.json();
  CUSTOM_WORDS = Storage.loadCustomWords();
  SRS_STATE = Storage.loadSrsState();
  STREAK = Storage.touchStreak();
  rebuildHeadwordMap();
  renderHome();
  initSync();
}

// ---------- device sync (Firebase) ----------

function collectLocalState() {
  return {
    srsState: SRS_STATE,
    streak: STREAK,
    customWords: CUSTOM_WORDS,
  };
}

// 원격 상태를 로컬에 병합합니다. 단어별 reviewCount(복습 누적 횟수)가
// 더 높은 쪽을 "더 진행된" 기록으로 간주해 충돌 없이 합칩니다.
function mergeRemoteState(remote) {
  if (!remote) return false;
  let changed = false;

  if (remote.srsState) {
    for (const [wid, rrec] of Object.entries(remote.srsState)) {
      const lrec = SRS_STATE[wid];
      if (!lrec || (rrec.reviewCount || 0) > (lrec.reviewCount || 0)) {
        SRS_STATE[wid] = rrec;
        changed = true;
      }
    }
    if (changed) Storage.saveSrsState(SRS_STATE);
  }

  if (remote.customWords && remote.customWords.length) {
    const added = Storage.appendCustomWords(remote.customWords);
    if (added) {
      CUSTOM_WORDS = Storage.loadCustomWords();
      rebuildHeadwordMap();
      changed = true;
    }
  }

  if (remote.streak) {
    const localDate = STREAK.lastActiveDate;
    const remoteDate = remote.streak.lastActiveDate;
    if (!localDate || (remoteDate && remoteDate > localDate)) {
      STREAK = remote.streak;
      Storage.saveStreak(STREAK);
      changed = true;
    } else if (remoteDate === localDate && (remote.streak.count || 0) > (STREAK.count || 0)) {
      STREAK = { ...STREAK, count: remote.streak.count };
      Storage.saveStreak(STREAK);
      changed = true;
    }
  }

  return changed;
}

function refreshIfIdle() {
  if (currentSession || LISTEN) return; // 학습/듣기 중에는 화면을 건드리지 않음
  if (currentView === "home") renderHome();
  else if (currentView === "stats") renderStats();
}

async function initSync() {
  if (!Sync.isSyncAvailable() || !Sync.getSyncCode()) return;
  syncStatus.state = "syncing";
  try {
    const remote = await Sync.fetchRemoteState();
    mergeRemoteState(remote);
    syncStatus = { state: "synced", lastSyncedAt: new Date(), error: null };
    refreshIfIdle();
    Sync.subscribeRemoteChanges((data) => {
      if (mergeRemoteState(data)) refreshIfIdle();
      syncStatus = { state: "synced", lastSyncedAt: new Date(), error: null };
      if (currentView === "stats") renderStats();
    });
  } catch (e) {
    syncStatus = { state: "error", lastSyncedAt: syncStatus.lastSyncedAt, error: e.message };
  }
}

function syncPush() {
  if (!Sync.getSyncCode()) return;
  syncStatus.state = "syncing";
  Sync.schedulePush(collectLocalState, () => {
    syncStatus = { state: "synced", lastSyncedAt: new Date(), error: null };
    if (currentView === "stats") renderStats();
  });
}

function allWords() {
  return BASE_WORDS.concat(CUSTOM_WORDS);
}

function rebuildHeadwordMap() {
  HEADWORD_MAP = {};
  for (const w of allWords()) {
    const shortMeaning = (w.meaning_kr || "").split(/[;,]/)[0].trim();
    HEADWORD_MAP[w.headword.toLowerCase()] = shortMeaning;
  }
}

const DEINFLECT_SUFFIXES = [
  [/ies$/, "y"],
  [/ied$/, "y"],
  [/ing$/, ""],
  [/ed$/, ""],
  [/es$/, ""],
  [/s$/, ""],
];

function lookupGloss(token) {
  const clean = token.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
  if (!clean) return null;
  if (HEADWORD_MAP[clean]) return HEADWORD_MAP[clean];
  if (GLOSSARY[clean]) return GLOSSARY[clean];
  for (const [pattern, replacement] of DEINFLECT_SUFFIXES) {
    if (pattern.test(clean)) {
      const base = clean.replace(pattern, replacement);
      if (HEADWORD_MAP[base]) return HEADWORD_MAP[base];
      if (GLOSSARY[base]) return GLOSSARY[base];
    }
  }
  return null;
}

function renderGlossedSentence(sentence) {
  const tokens = sentence.split(/(\s+)/);
  return tokens
    .map((tok) => {
      if (/^\s+$/.test(tok)) return tok;
      const gloss = lookupGloss(tok);
      const safeTok = escapeHtml(tok);
      if (!gloss) return `<span class="gloss-word">${safeTok}</span>`;
      return `<ruby class="gloss-word">${safeTok}<rt>${escapeHtml(gloss)}</rt></ruby>`;
    })
    .join("");
}

function wordsOf(level, category) {
  return allWords()
    .filter((w) => w.level === level && (!category || w.category === category))
    .sort((a, b) => (a.freq || 3) - (b.freq || 3) || a.id - b.id);
}

function getRecord(wordId) {
  return SRS_STATE[wordId] || null;
}

function ensureRecord(wordId) {
  if (!SRS_STATE[wordId]) {
    SRS_STATE[wordId] = SRS.createInitialRecord(wordId);
  }
  return SRS_STATE[wordId];
}

function levelStats(level) {
  const words = wordsOf(level);
  const total = words.length;
  let mastered = 0;
  for (const w of words) {
    const rec = getRecord(w.id);
    if (rec && SRS.isMastered(rec)) mastered++;
  }
  return { total, mastered, percent: total ? mastered / total : 0 };
}

function isLevelUnlocked() {
  return true;
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks.length ? chunks : [[]];
}

function allUnlockedWords() {
  let words = [];
  for (const l of META.levels) {
    if (isLevelUnlocked(l.level)) {
      words = words.concat(wordsOf(l.level));
    }
  }
  return words;
}

// 이미 한 번 이상 학습한(기록이 있는) 단어만 복습 대상으로 삼는다.
function reviewedWordsPool() {
  return allUnlockedWords().filter((w) => !!getRecord(w.id));
}

// 박스가 낮은(모르는) 단어일수록 여러 번 포함시켜 더 자주 등장하게 만든다.
function buildReviewQueue(cap) {
  const pool = reviewedWordsPool();
  const multiset = [];
  for (const w of pool) {
    const rec = getRecord(w.id);
    const n = SRS.repeatCountForBox(rec.box);
    for (let i = 0; i < n; i++) multiset.push(w);
  }
  const shuffled = shuffleArray(multiset);
  return typeof cap === "number" && isFinite(cap) ? shuffled.slice(0, cap) : shuffled;
}

function reviewPoolInfo() {
  const pool = reviewedWordsPool();
  const weakCount = pool.filter((w) => (getRecord(w.id).box || 1) <= 2).length;
  return { total: pool.length, weakCount };
}

// ---------- rendering helpers ----------

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function freqBadge(word) {
  const f = word.freq || 3;
  if (f === 1) return `<span class="freq-badge freq-1" title="최빈출">⭐⭐⭐</span>`;
  if (f === 2) return `<span class="freq-badge freq-2" title="빈출">⭐⭐</span>`;
  return `<span class="freq-badge freq-3" title="보통">⭐</span>`;
}

function masteryDotClass(word) {
  const rec = getRecord(word.id);
  if (!rec) return "dot-new";
  if (SRS.isMastered(rec)) return "dot-mastered";
  return "dot-learning";
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";
  utter.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

// ---------- views ----------

function renderHome() {
  currentSession = null;
  currentLevelView = null;
  currentView = "home";
  const poolInfo = reviewPoolInfo();

  const levelCards = META.levels
    .map((l) => {
      const stats = levelStats(l.level);
      const pct = Math.round(stats.percent * 100);
      return `
      <div class="level-card" data-level="${l.level}">
        <div class="level-card-head">
          <span class="level-badge level-${l.level}">${l.name}</span>
          <span class="level-title">${escapeHtml(l.label)}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="level-sub">${stats.mastered} / ${stats.total} 단어 완료 (${pct}%)</div>
      </div>`;
    })
    .join("");

  root.innerHTML = `
    <div class="topbar">
      <div class="app-title">토익 900 단어장</div>
      <div class="streak">🔥 ${STREAK.count}일 연속</div>
    </div>
    <div class="today-card">
      <div class="today-title">오늘의 복습</div>
      <div class="today-desc">${
        poolInfo.total > 0
          ? `학습한 단어 ${poolInfo.total}개 중 약한 단어 ${poolInfo.weakCount}개가 더 자주 나옵니다`
          : "아직 학습한 단어가 없습니다. 먼저 파트를 하나 학습해 보세요."
      }</div>
      <button class="btn btn-primary" id="btn-start-today">오늘 복습 시작</button>
      <button class="btn btn-listen" id="btn-listen-today">🎧 오늘 단어 듣기</button>
    </div>
    <div class="level-list">${levelCards}</div>
    <div class="bottom-nav">
      <button class="nav-btn active" data-nav="home">홈</button>
      <button class="nav-btn" data-nav="stats">통계/설정</button>
    </div>
  `;

  document.getElementById("btn-start-today").addEventListener("click", () => {
    if (poolInfo.total === 0) {
      toast("먼저 레벨에서 파트를 하나 학습해 보세요.");
      return;
    }
    startSession(buildReviewQueue(60));
  });

  document.getElementById("btn-listen-today").addEventListener("click", () => {
    if (poolInfo.total === 0) {
      toast("먼저 레벨에서 파트를 하나 학습해 보세요.");
      return;
    }
    startListening(buildReviewQueue(), false);
  });

  root.querySelectorAll(".level-card").forEach((el) => {
    el.addEventListener("click", () => {
      const level = Number(el.dataset.level);
      renderLevel(level);
    });
  });

  bindBottomNav();
}

function renderLevel(level) {
  currentView = "other";
  const levelDef = META.levels.find((l) => l.level === level);
  const categories = levelDef.categories;

  if (categories.length > 1) {
    // category picker (Level 2)
    const chips = categories
      .map((cat) => {
        const words = wordsOf(level, cat);
        let mastered = 0;
        words.forEach((w) => {
          const rec = getRecord(w.id);
          if (rec && SRS.isMastered(rec)) mastered++;
        });
        return `<div class="cat-chip" data-cat="${cat}">
          <div class="cat-name">${escapeHtml(META.categoryLabels[cat] || cat)}</div>
          <div class="cat-sub">${mastered}/${words.length}</div>
        </div>`;
      })
      .join("");

    root.innerHTML = `
      <div class="topbar"><button class="back-btn" id="btn-back">← 뒤로</button><div class="app-title">${escapeHtml(
        levelDef.label
      )}</div><div></div></div>
      <div class="cat-grid">${chips}</div>
      <div class="bottom-nav">
        <button class="nav-btn" data-nav="home">홈</button>
        <button class="nav-btn" data-nav="stats">통계/설정</button>
      </div>
    `;
    document.getElementById("btn-back").addEventListener("click", renderHome);
    root.querySelectorAll(".cat-chip").forEach((el) => {
      el.addEventListener("click", () => renderPartList(level, el.dataset.cat));
    });
    bindBottomNav();
  } else {
    renderPartList(level, categories[0]);
  }
}

function renderPartList(level, category) {
  currentView = "other";
  currentLevelView = { level, category };
  const words = wordsOf(level, category);
  const label = META.categoryLabels[category] || category;
  const parts = chunkArray(words, PART_SIZE);

  const cards = parts
    .map((partWords, i) => {
      let mastered = 0;
      partWords.forEach((w) => {
        const rec = getRecord(w.id);
        if (rec && SRS.isMastered(rec)) mastered++;
      });
      const start = i * PART_SIZE + 1;
      const end = i * PART_SIZE + partWords.length;
      return `<div class="part-card" data-part="${i}">
        <div class="part-name">Part ${i + 1} <span class="part-range">(${start}-${end})</span></div>
        <div class="part-sub">${mastered}/${partWords.length} 완료</div>
      </div>`;
    })
    .join("");

  root.innerHTML = `
    <div class="topbar"><button class="back-btn" id="btn-back">← 뒤로</button><div class="app-title">${escapeHtml(
      label
    )}</div><div></div></div>
    <div class="part-list-desc">하루 ${PART_SIZE}개씩 파트로 나눴습니다. 원하는 파트를 선택하세요.</div>
    <div class="part-grid">${cards}</div>
    <div class="bottom-nav">
      <button class="nav-btn" data-nav="home">홈</button>
      <button class="nav-btn" data-nav="stats">통계/설정</button>
    </div>
  `;

  document.getElementById("btn-back").addEventListener("click", () => {
    const levelDef = META.levels.find((l) => l.level === level);
    if (levelDef.categories.length > 1) renderLevel(level);
    else renderHome();
  });

  root.querySelectorAll(".part-card").forEach((el) => {
    el.addEventListener("click", () => renderPartDetail(level, category, Number(el.dataset.part)));
  });

  bindBottomNav();
}

function renderPartDetail(level, category, partIndex) {
  currentView = "other";
  currentLevelView = { level, category, partIndex };
  const allPartsWords = wordsOf(level, category);
  const parts = chunkArray(allPartsWords, PART_SIZE);
  const words = parts[partIndex] || [];
  const label = META.categoryLabels[category] || category;

  const rows = words
    .map((w) => {
      return `<div class="word-row" data-id="${w.id}">
        <span class="dot ${masteryDotClass(w)}"></span>
        ${freqBadge(w)}
        <span class="word-head">${escapeHtml(w.headword)}</span>
        <span class="word-pos">${escapeHtml(w.pos)}</span>
        <span class="word-meaning">${escapeHtml(w.meaning_kr)}</span>
      </div>`;
    })
    .join("");

  root.innerHTML = `
    <div class="topbar"><button class="back-btn" id="btn-back">← 뒤로</button><div class="app-title">${escapeHtml(
      label
    )} · Part ${partIndex + 1}</div><div></div></div>
    <div class="chapter-actions">
      <button class="btn btn-primary" id="btn-study-chapter">이 파트 학습하기 (${words.length}개)</button>
      <button class="btn btn-listen" id="btn-listen-chapter">🎧 이 파트 듣기 모드</button>
      <label class="shuffle-toggle"><input type="checkbox" id="chk-study-shuffle"/> 🔀 랜덤 순서로 학습</label>
      <div class="chapter-sub">횟수 제한 없이 몇 번이든 반복해서 학습할 수 있습니다</div>
    </div>
    <div class="word-list">${rows}</div>
    <div class="bottom-nav">
      <button class="nav-btn" data-nav="home">홈</button>
      <button class="nav-btn" data-nav="stats">통계/설정</button>
    </div>
  `;

  document.getElementById("btn-back").addEventListener("click", () => renderPartList(level, category));

  document.getElementById("btn-study-chapter").addEventListener("click", () => {
    const shuffle = document.getElementById("chk-study-shuffle").checked;
    const queue = shuffle ? shuffleArray(words) : words.slice();
    startSession(queue);
  });

  document.getElementById("btn-listen-chapter").addEventListener("click", () => {
    startListening(words, true);
  });

  root.querySelectorAll(".word-row").forEach((el, idx) => {
    el.addEventListener("click", () => {
      showWordDetail(words, idx);
    });
  });

  bindBottomNav();
}

// ---------- word detail modal (발음/예문 보기 + 다음/이전 넘기기) ----------

function wordDetailCurrent(state) {
  return state.words[state.visited[state.pos]];
}

function wordDetailGo(state, dir) {
  if (dir < 0) {
    if (state.pos > 0) state.pos--;
    return;
  }
  if (state.pos < state.visited.length - 1) {
    state.pos++;
    return;
  }
  const curIdx = state.visited[state.pos];
  let nextIdx;
  if (state.words.length <= 1) {
    nextIdx = curIdx;
  } else if (state.random) {
    do {
      nextIdx = Math.floor(Math.random() * state.words.length);
    } while (nextIdx === curIdx);
  } else {
    nextIdx = (curIdx + 1) % state.words.length;
  }
  state.visited.push(nextIdx);
  state.pos++;
}

function showWordDetail(words, startIndex) {
  const state = {
    words,
    visited: [startIndex],
    pos: 0,
    random: false,
  };

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay word-detail-overlay";
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  function render() {
    const word = wordDetailCurrent(state);
    const curIdx = state.visited[state.pos];
    const derivHtml = (word.derivatives || [])
      .map((d) => `<span class="deriv-chip">${escapeHtml(d.form)} <i>(${escapeHtml(d.pos)})</i></span>`)
      .join("");
    const collocHtml = (word.collocations || [])
      .map((c) => `<span class="colloc-chip">${escapeHtml(c)}</span>`)
      .join("");
    const noteHtml = word.note ? `<div class="word-note">⚠️ ${escapeHtml(word.note)}</div>` : "";
    const hasMore = state.words.length > 1;

    overlay.innerHTML = `
      <div class="modal-box word-detail-box">
        <button class="word-detail-close" id="btn-word-detail-close">✕</button>
        ${state.words.length > 1 ? `<div class="word-detail-progress">${curIdx + 1} / ${state.words.length}</div>` : ""}
        <div class="card-freq">${freqBadge(word)}</div>
        <div class="word-headword">${escapeHtml(word.headword)}</div>
        <div class="word-ipa">${escapeHtml(word.ipa || "")}</div>
        <div class="word-pos-badge">${escapeHtml(word.pos)}</div>
        <button class="speak-btn" id="btn-word-detail-speak">🔊 발음 듣기</button>
        <div class="word-meaning-big">${escapeHtml(word.meaning_kr)}</div>
        <div class="example-en">${renderGlossedSentence(word.example_en)}</div>
        <div class="example-kr">${escapeHtml(word.example_kr)}</div>
        ${derivHtml ? `<div class="deriv-row">${derivHtml}</div>` : ""}
        ${collocHtml ? `<div class="colloc-row">${collocHtml}</div>` : ""}
        ${noteHtml}
        ${
          hasMore
            ? `<div class="word-detail-nav">
                <button class="word-detail-prev-btn" id="btn-word-detail-prev" ${
                  state.pos === 0 ? "disabled" : ""
                }>⏮ 이전</button>
                <button class="word-detail-next-btn" id="btn-word-detail-next">다음 ⏭</button>
              </div>
              <label class="shuffle-toggle"><input type="checkbox" id="chk-word-detail-random" ${
                state.random ? "checked" : ""
              }/> 🔀 다음 단어 랜덤으로 넘기기</label>`
            : ""
        }
      </div>
    `;

    overlay.querySelector("#btn-word-detail-close").addEventListener("click", close);
    overlay.querySelector("#btn-word-detail-speak").addEventListener("click", () => speak(word.headword));

    const prevBtn = overlay.querySelector("#btn-word-detail-prev");
    if (prevBtn) {
      prevBtn.addEventListener("click", () => {
        wordDetailGo(state, -1);
        render();
      });
    }
    const nextBtn = overlay.querySelector("#btn-word-detail-next");
    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        wordDetailGo(state, 1);
        render();
      });
    }
    const randomChk = overlay.querySelector("#chk-word-detail-random");
    if (randomChk) {
      randomChk.addEventListener("change", (e) => {
        state.random = e.target.checked;
      });
    }

    speak(word.headword);
  }

  render();
}

function formatSyncTime(date) {
  if (!date) return "";
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 5) return "방금 전";
  if (diffSec < 60) return `${diffSec}초 전`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;
  return date.toLocaleString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function renderSyncBlock() {
  if (!Sync.isSyncAvailable()) {
    return `
      <div class="sync-block">
        <div class="sync-title">📱💻 기기 간 동기화</div>
        <div class="sync-desc">동기화 기능이 아직 설정되지 않았습니다. (SYNC_SETUP.md 참고)</div>
      </div>`;
  }

  const code = Sync.getSyncCode();
  if (!code) {
    return `
      <div class="sync-block">
        <div class="sync-title">📱💻 기기 간 동기화</div>
        <div class="sync-desc">동기화 코드를 만들면 다른 기기에서 같은 코드를 입력해 학습 진도를 실시간으로 공유할 수 있습니다.</div>
        <button class="btn btn-secondary" id="btn-sync-create">새 동기화 코드 만들기</button>
        <div class="sync-link-row">
          <input type="text" id="sync-code-input" placeholder="다른 기기의 코드 입력 (예: AB3D9K)" maxlength="6" />
          <button class="btn btn-secondary" id="btn-sync-link">연결하기</button>
        </div>
        <div class="import-result" id="sync-result"></div>
      </div>`;
  }

  const statusText =
    syncStatus.state === "syncing"
      ? "🔄 동기화 중..."
      : syncStatus.state === "error"
      ? `⚠️ 동기화 오류: ${escapeHtml(syncStatus.error || "")}`
      : syncStatus.lastSyncedAt
      ? `🟢 마지막 동기화: ${formatSyncTime(syncStatus.lastSyncedAt)}`
      : "🟢 연결됨";

  return `
    <div class="sync-block">
      <div class="sync-title">📱💻 기기 간 동기화</div>
      <div class="sync-desc">이 코드를 다른 기기의 통계/설정 화면에 입력하면 학습 진도가 자동으로 합쳐집니다.</div>
      <div class="sync-code-box" id="sync-code-box" title="탭하여 복사">${escapeHtml(code)}</div>
      <div class="sync-status">${statusText}</div>
      <button class="btn btn-secondary" id="btn-sync-refresh">지금 동기화</button>
      <button class="btn btn-danger" id="btn-sync-stop">동기화 해제</button>
      <div class="import-result" id="sync-result"></div>
    </div>`;
}

function bindSyncEvents() {
  const resultEl = document.getElementById("sync-result");
  const setResult = (msg, ok) => {
    if (!resultEl) return;
    resultEl.textContent = msg;
    resultEl.className = "import-result " + (ok ? "success" : "error");
  };

  const createBtn = document.getElementById("btn-sync-create");
  if (createBtn) {
    createBtn.addEventListener("click", async () => {
      createBtn.disabled = true;
      createBtn.textContent = "생성 중...";
      try {
        await Sync.createSyncCode(collectLocalState());
        syncStatus = { state: "synced", lastSyncedAt: new Date(), error: null };
        Sync.subscribeRemoteChanges((data) => {
          if (mergeRemoteState(data)) refreshIfIdle();
          syncStatus = { state: "synced", lastSyncedAt: new Date(), error: null };
          if (currentView === "stats") renderStats();
        });
        renderStats();
      } catch (e) {
        createBtn.disabled = false;
        createBtn.textContent = "새 동기화 코드 만들기";
        setResult("오류: " + e.message, false);
      }
    });
  }

  const linkBtn = document.getElementById("btn-sync-link");
  if (linkBtn) {
    linkBtn.addEventListener("click", async () => {
      const input = document.getElementById("sync-code-input");
      const code = (input.value || "").trim();
      if (!code) {
        setResult("코드를 입력해 주세요.", false);
        return;
      }
      linkBtn.disabled = true;
      linkBtn.textContent = "연결 중...";
      try {
        const remote = await Sync.linkSyncCode(code);
        mergeRemoteState(remote);
        syncPush();
        syncStatus = { state: "synced", lastSyncedAt: new Date(), error: null };
        Sync.subscribeRemoteChanges((data) => {
          if (mergeRemoteState(data)) refreshIfIdle();
          syncStatus = { state: "synced", lastSyncedAt: new Date(), error: null };
          if (currentView === "stats") renderStats();
        });
        toast("연결되었습니다. 진도가 합쳐졌습니다.");
        renderStats();
      } catch (e) {
        linkBtn.disabled = false;
        linkBtn.textContent = "연결하기";
        setResult("오류: " + e.message, false);
      }
    });
  }

  const codeBox = document.getElementById("sync-code-box");
  if (codeBox) {
    codeBox.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(codeBox.textContent.trim());
        toast("코드를 복사했습니다.");
      } catch (e) {
        toast("복사에 실패했습니다. 직접 입력해 주세요.");
      }
    });
  }

  const refreshBtn = document.getElementById("btn-sync-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      syncStatus.state = "syncing";
      renderStats();
      try {
        const remote = await Sync.fetchRemoteState();
        mergeRemoteState(remote);
        syncPush();
        syncStatus = { state: "synced", lastSyncedAt: new Date(), error: null };
      } catch (e) {
        syncStatus = { state: "error", lastSyncedAt: syncStatus.lastSyncedAt, error: e.message };
      }
      renderStats();
    });
  }

  const stopBtn = document.getElementById("btn-sync-stop");
  if (stopBtn) {
    stopBtn.addEventListener("click", () => {
      showConfirm("동기화를 해제하시겠습니까? 이 기기의 학습 기록은 그대로 유지됩니다.", () => {
        Sync.stopSync();
        syncStatus = { state: "idle", lastSyncedAt: null, error: null };
        toast("동기화가 해제되었습니다.");
        renderStats();
      });
    });
  }
}

function renderStats() {
  currentView = "stats";
  const rows = META.levels
    .map((l) => {
      const s = levelStats(l.level);
      const pct = Math.round(s.percent * 100);
      return `<tr>
        <td>${l.name}</td>
        <td>${escapeHtml(l.label)}</td>
        <td>${s.mastered}/${s.total}</td>
        <td>${pct}%</td>
      </tr>`;
    })
    .join("");

  root.innerHTML = `
    <div class="topbar"><button class="back-btn" id="btn-back">← 뒤로</button><div class="app-title">통계 / 설정</div><div></div></div>
    <div class="stats-block">
      <div class="stats-summary">🔥 연속 학습 ${STREAK.count}일 · 오늘 복습 ${STREAK.todayReviewed || 0}개</div>
      <table class="stats-table">
        <thead><tr><th>레벨</th><th>이름</th><th>완료</th><th>%</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${renderSyncBlock()}
    <div class="import-block">
      <div class="import-title">단어 데이터 추가 (JSON 가져오기)</div>
      <div class="import-desc">words.json과 동일한 스키마의 JSON 배열을 붙여넣으면 단어장에 병합됩니다. (8,000개까지 확장 가능)</div>
      <textarea id="import-textarea" rows="6" placeholder='[{"id":1000,"headword":"example","pos":"n","level":2,"category":"office","meaning_kr":"예시","example_en":"...","example_kr":"...","derivatives":[],"collocations":[]}]'></textarea>
      <button class="btn btn-secondary" id="btn-import">가져오기</button>
      <div class="import-result" id="import-result"></div>
    </div>
    <div class="danger-block">
      <button class="btn btn-danger" id="btn-reset">학습 기록 초기화</button>
    </div>
    <div class="bottom-nav">
      <button class="nav-btn" data-nav="home">홈</button>
      <button class="nav-btn active" data-nav="stats">통계/설정</button>
    </div>
  `;

  document.getElementById("btn-back").addEventListener("click", renderHome);

  document.getElementById("btn-import").addEventListener("click", () => {
    const ta = document.getElementById("import-textarea");
    const resultEl = document.getElementById("import-result");
    try {
      const parsed = JSON.parse(ta.value);
      if (!Array.isArray(parsed)) throw new Error("배열 형식이 아닙니다.");
      for (const w of parsed) {
        if (typeof w.id !== "number" || !w.headword || !w.meaning_kr || typeof w.level !== "number" || !w.category) {
          throw new Error("각 단어는 id, headword, meaning_kr, level, category 필드가 필요합니다.");
        }
      }
      const added = Storage.appendCustomWords(parsed);
      CUSTOM_WORDS = Storage.loadCustomWords();
      rebuildHeadwordMap();
      resultEl.textContent = `${added}개 단어가 추가되었습니다. (전체 ${allWords().length}개)`;
      resultEl.className = "import-result success";
      ta.value = "";
      syncPush();
    } catch (e) {
      resultEl.textContent = "오류: " + e.message;
      resultEl.className = "import-result error";
    }
  });

  document.getElementById("btn-reset").addEventListener("click", () => {
    showConfirm("모든 학습 기록(SRS 진행 상황)을 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.", () => {
      SRS_STATE = {};
      Storage.saveSrsState(SRS_STATE);
      syncPush();
      toast("학습 기록이 초기화되었습니다.");
      renderStats();
    });
  });

  bindSyncEvents();
  bindBottomNav();
}

function bindBottomNav() {
  root.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.nav === "home") renderHome();
      else if (btn.dataset.nav === "stats") renderStats();
    });
  });
}

// ---------- study session ----------

function startSession(words) {
  if (!words.length) {
    toast("학습할 단어가 없습니다.");
    return;
  }
  currentSession = {
    queue: words.slice(),
    index: 0,
    flipped: false,
    stats: { reviewed: 0, again: 0 },
  };
  renderStudy();
}

function renderStudy() {
  const s = currentSession;
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
    if (currentSession.flipped) return;
    currentSession.flipped = true;
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
  const s = currentSession;
  const word = s.queue[s.index];
  const rec = ensureRecord(word.id);
  SRS_STATE[word.id] = SRS.review(rec, quality);
  Storage.saveSrsState(SRS_STATE);
  Storage.incrementTodayReviewed();
  STREAK = Storage.loadStreak();
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
  const s = currentSession;
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

// ---------- listening mode (hands-free audio playback) ----------

let VOICES = [];
function loadVoices() {
  VOICES = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
}
if ("speechSynthesis" in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function pickVoice(langPrefix) {
  return VOICES.find((v) => v.lang && v.lang.toLowerCase().startsWith(langPrefix.toLowerCase()));
}

function makeUtterance(text, lang, rate) {
  const u = new SpeechSynthesisUtterance(text || "");
  u.lang = lang;
  const voice = pickVoice(lang.split("-")[0]);
  if (voice) u.voice = voice;
  u.rate = rate || 0.95;
  return u;
}

let LISTEN = null; // { words, originalWords, index, playing, loop, shuffled, finished }

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildListenQueueFrom(words, startIndex) {
  const utterances = [];
  for (let i = startIndex; i < words.length; i++) {
    const w = words[i];
    const meaning = (w.meaning_kr || "").split(/[;,]/)[0].trim();
    const seq = [
      makeUtterance(w.headword, "en-US", 0.95),
      makeUtterance(meaning, "ko-KR", 1),
      makeUtterance(w.headword, "en-US", 0.95),
      makeUtterance(meaning, "ko-KR", 1),
      makeUtterance(w.example_en, "en-US", 0.92),
      makeUtterance(w.example_kr, "ko-KR", 1),
      makeUtterance(w.example_en, "en-US", 0.92),
      makeUtterance(w.example_kr, "ko-KR", 1),
    ];
    seq.forEach((u) => {
      u.__wordIndex = i;
    });
    utterances.push(...seq);
  }
  return utterances;
}

function startListening(words, loop) {
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
  };
  playListenFrom(0);
}

function setShuffleListening(on) {
  if (!LISTEN) return;
  LISTEN.shuffled = on;
  LISTEN.words = on ? shuffleArray(LISTEN.originalWords) : LISTEN.originalWords.slice();
  playListenFrom(0);
}

function playListenFrom(idx) {
  if (!LISTEN) return;
  window.speechSynthesis.cancel();
  if (idx >= LISTEN.words.length) {
    if (LISTEN.loop) {
      playListenFrom(0);
    } else {
      LISTEN.playing = false;
      LISTEN.finished = true;
      renderListening();
    }
    return;
  }
  LISTEN.index = idx;
  LISTEN.playing = true;
  LISTEN.finished = false;
  const queue = buildListenQueueFrom(LISTEN.words, idx);
  queue.forEach((u) => {
    u.onstart = () => {
      if (!LISTEN) return;
      if (LISTEN.index !== u.__wordIndex) {
        LISTEN.index = u.__wordIndex;
        renderListening();
      }
    };
  });
  const last = queue[queue.length - 1];
  last.onend = () => {
    if (!LISTEN) return;
    if (LISTEN.loop) {
      playListenFrom(0);
    } else {
      LISTEN.playing = false;
      LISTEN.finished = true;
      renderListening();
    }
  };
  queue.forEach((u) => window.speechSynthesis.speak(u));
  renderListening();
}

function pauseListening() {
  if (!LISTEN) return;
  window.speechSynthesis.pause();
  LISTEN.playing = false;
  renderListening();
}

function resumeListening() {
  if (!LISTEN) return;
  window.speechSynthesis.resume();
  LISTEN.playing = true;
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

function stopListening() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  LISTEN = null;
}

function renderListening() {
  if (!LISTEN) return;
  const word = LISTEN.words[LISTEN.index];
  const statusText = LISTEN.finished ? "🎉 재생 완료" : LISTEN.playing ? "🔊 재생 중... (다른 일을 하셔도 계속 재생됩니다)" : "⏸ 일시정지";

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

// ---------- toast ----------
let toastTimer = null;
function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// ---------- confirm modal (in-page, replaces window.confirm) ----------
function showConfirm(message, onConfirm) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-msg">${escapeHtml(message)}</div>
      <div class="modal-actions">
        <button class="btn modal-cancel">취소</button>
        <button class="btn btn-primary modal-ok">확인</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector(".modal-cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".modal-ok").addEventListener("click", () => {
    close();
    onConfirm();
  });
}

init();
