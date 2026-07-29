// 화면 렌더링(홈/레벨/파트/단어 상세/통계/동기화 설정) 전담 모듈
import { root } from "./dom.js?v=1";
import { escapeHtml, freqBadge, chunkArray, shuffleArray } from "./utils.js?v=1";
import { toast, showConfirm } from "./ui.js?v=1";
import * as SRS from "./srs.js";
import * as Storage from "./storage.js";
import * as Sync from "./sync.js?v=2";
import {
  state,
  allWords,
  wordsOf,
  levelStats,
  getRecord,
  lookupGloss,
  rebuildHeadwordMap,
  reviewPoolInfo,
  buildReviewQueue,
} from "./state.js?v=1";
import { collectLocalState, mergeRemoteState, syncPush, refreshIfIdle } from "./sync-bridge.js?v=1";
import { speak, startListening } from "./tts.js?v=1";
import { startSession } from "./study.js?v=1";

const PART_SIZE = 100;

function masteryDotClass(word) {
  const rec = getRecord(word.id);
  if (!rec) return "dot-new";
  if (SRS.isMastered(rec)) return "dot-mastered";
  return "dot-learning";
}

export function renderGlossedSentence(sentence) {
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

// ---------- views ----------

export function renderHome() {
  state.currentSession = null;
  state.currentLevelView = null;
  state.currentView = "home";
  const poolInfo = reviewPoolInfo();

  const levelCards = state.META.levels
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
      <div class="streak">🔥 ${state.STREAK.count}일 연속</div>
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
  state.currentView = "other";
  const levelDef = state.META.levels.find((l) => l.level === level);
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
          <div class="cat-name">${escapeHtml(state.META.categoryLabels[cat] || cat)}</div>
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
  state.currentView = "other";
  state.currentLevelView = { level, category };
  const words = wordsOf(level, category);
  const label = state.META.categoryLabels[category] || category;
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
    const levelDef = state.META.levels.find((l) => l.level === level);
    if (levelDef.categories.length > 1) renderLevel(level);
    else renderHome();
  });

  root.querySelectorAll(".part-card").forEach((el) => {
    el.addEventListener("click", () => renderPartDetail(level, category, Number(el.dataset.part)));
  });

  bindBottomNav();
}

function renderPartDetail(level, category, partIndex) {
  state.currentView = "other";
  state.currentLevelView = { level, category, partIndex };
  const allPartsWords = wordsOf(level, category);
  const parts = chunkArray(allPartsWords, PART_SIZE);
  const words = parts[partIndex] || [];
  const label = state.META.categoryLabels[category] || category;

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

function wordDetailCurrent(dstate) {
  return dstate.words[dstate.visited[dstate.pos]];
}

function wordDetailGo(dstate, dir) {
  if (dir < 0) {
    if (dstate.pos > 0) dstate.pos--;
    return;
  }
  if (dstate.pos < dstate.visited.length - 1) {
    dstate.pos++;
    return;
  }
  const curIdx = dstate.visited[dstate.pos];
  let nextIdx;
  if (dstate.words.length <= 1) {
    nextIdx = curIdx;
  } else if (dstate.random) {
    do {
      nextIdx = Math.floor(Math.random() * dstate.words.length);
    } while (nextIdx === curIdx);
  } else {
    nextIdx = (curIdx + 1) % dstate.words.length;
  }
  dstate.visited.push(nextIdx);
  dstate.pos++;
}

function showWordDetail(words, startIndex) {
  const detailState = {
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
    const word = wordDetailCurrent(detailState);
    const curIdx = detailState.visited[detailState.pos];
    const derivHtml = (word.derivatives || [])
      .map((d) => `<span class="deriv-chip">${escapeHtml(d.form)} <i>(${escapeHtml(d.pos)})</i></span>`)
      .join("");
    const collocHtml = (word.collocations || [])
      .map((c) => `<span class="colloc-chip">${escapeHtml(c)}</span>`)
      .join("");
    const noteHtml = word.note ? `<div class="word-note">⚠️ ${escapeHtml(word.note)}</div>` : "";
    const hasMore = detailState.words.length > 1;

    overlay.innerHTML = `
      <div class="modal-box word-detail-box">
        <button class="word-detail-close" id="btn-word-detail-close">✕</button>
        ${
          detailState.words.length > 1
            ? `<div class="word-detail-progress">${curIdx + 1} / ${detailState.words.length}</div>`
            : ""
        }
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
                  detailState.pos === 0 ? "disabled" : ""
                }>⏮ 이전</button>
                <button class="word-detail-next-btn" id="btn-word-detail-next">다음 ⏭</button>
              </div>
              <label class="shuffle-toggle"><input type="checkbox" id="chk-word-detail-random" ${
                detailState.random ? "checked" : ""
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
        wordDetailGo(detailState, -1);
        render();
      });
    }
    const nextBtn = overlay.querySelector("#btn-word-detail-next");
    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        wordDetailGo(detailState, 1);
        render();
      });
    }
    const randomChk = overlay.querySelector("#chk-word-detail-random");
    if (randomChk) {
      randomChk.addEventListener("change", (e) => {
        detailState.random = e.target.checked;
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
    state.syncStatus.state === "syncing"
      ? "🔄 동기화 중..."
      : state.syncStatus.state === "error"
      ? `⚠️ 동기화 오류: ${escapeHtml(state.syncStatus.error || "")}`
      : state.syncStatus.lastSyncedAt
      ? `🟢 마지막 동기화: ${formatSyncTime(state.syncStatus.lastSyncedAt)}`
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
        state.syncStatus = { state: "synced", lastSyncedAt: new Date(), error: null };
        Sync.subscribeRemoteChanges((data) => {
          if (mergeRemoteState(data)) refreshIfIdle();
          state.syncStatus = { state: "synced", lastSyncedAt: new Date(), error: null };
          if (state.currentView === "stats") renderStats();
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
        state.syncStatus = { state: "synced", lastSyncedAt: new Date(), error: null };
        Sync.subscribeRemoteChanges((data) => {
          if (mergeRemoteState(data)) refreshIfIdle();
          state.syncStatus = { state: "synced", lastSyncedAt: new Date(), error: null };
          if (state.currentView === "stats") renderStats();
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
      state.syncStatus.state = "syncing";
      renderStats();
      try {
        const remote = await Sync.fetchRemoteState();
        mergeRemoteState(remote);
        syncPush();
        state.syncStatus = { state: "synced", lastSyncedAt: new Date(), error: null };
      } catch (e) {
        state.syncStatus = { state: "error", lastSyncedAt: state.syncStatus.lastSyncedAt, error: e.message };
      }
      renderStats();
    });
  }

  const stopBtn = document.getElementById("btn-sync-stop");
  if (stopBtn) {
    stopBtn.addEventListener("click", () => {
      showConfirm("동기화를 해제하시겠습니까? 이 기기의 학습 기록은 그대로 유지됩니다.", () => {
        Sync.stopSync();
        state.syncStatus = { state: "idle", lastSyncedAt: null, error: null };
        toast("동기화가 해제되었습니다.");
        renderStats();
      });
    });
  }
}

export function renderStats() {
  state.currentView = "stats";
  const rows = state.META.levels
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
      <div class="stats-summary">🔥 연속 학습 ${state.STREAK.count}일 · 오늘 복습 ${state.STREAK.todayReviewed || 0}개</div>
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
      const validLevels = new Set((state.META.levels || []).map((l) => l.level));
      const seenIds = new Set(allWords().map((w) => w.id));
      for (const w of parsed) {
        if (
          typeof w.id !== "number" ||
          typeof w.headword !== "string" || !w.headword.trim() ||
          typeof w.meaning_kr !== "string" || !w.meaning_kr.trim() ||
          typeof w.level !== "number" ||
          typeof w.category !== "string" || !w.category.trim()
        ) {
          throw new Error("각 단어는 id(숫자), headword(문자열), meaning_kr(문자열), level(숫자), category(문자열) 필드가 필요합니다.");
        }
        if (!validLevels.has(w.level)) {
          throw new Error(`level 값은 ${[...validLevels].join(", ")} 중 하나여야 합니다. (${w.headword}: ${w.level})`);
        }
        if (w.derivatives !== undefined && !Array.isArray(w.derivatives)) {
          throw new Error(`derivatives는 배열이어야 합니다. (${w.headword})`);
        }
        if (w.collocations !== undefined && !Array.isArray(w.collocations)) {
          throw new Error(`collocations는 배열이어야 합니다. (${w.headword})`);
        }
        if (seenIds.has(w.id)) {
          throw new Error(`id ${w.id}는 이미 사용 중입니다. 다른 id를 지정해 주세요.`);
        }
        seenIds.add(w.id);
      }
      const added = Storage.appendCustomWords(parsed);
      state.CUSTOM_WORDS = Storage.loadCustomWords();
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
      state.SRS_STATE = {};
      Storage.saveSrsState(state.SRS_STATE);
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
