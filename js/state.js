// 앱 전역 상태(단어 데이터/SRS 진행상황/현재 화면)와 그 상태만으로 계산되는
// 순수 조회 함수들. 렌더링(HTML 생성)이나 동기화 네트워킹은 다루지 않습니다.
import * as SRS from "./srs.js";
import { shuffleArray } from "./utils.js?v=1";

export const state = {
  META: null,
  BASE_WORDS: [],
  CUSTOM_WORDS: [],
  SRS_STATE: {},
  STREAK: null,
  GLOSSARY: {},
  HEADWORD_MAP: {},

  currentSession: null, // { queue: [word,...], index, flipped, stats:{reviewed,new} }
  currentLevelView: null, // { level, category }
  currentView: "home", // "home" | "stats" | other (study/level views skip auto-refresh)
  syncStatus: { state: "idle", lastSyncedAt: null, error: null }, // state: idle|syncing|synced|error
};

export function allWords() {
  return state.BASE_WORDS.concat(state.CUSTOM_WORDS);
}

export function rebuildHeadwordMap() {
  state.HEADWORD_MAP = {};
  for (const w of allWords()) {
    const shortMeaning = (w.meaning_kr || "").split(/[;,]/)[0].trim();
    state.HEADWORD_MAP[w.headword.toLowerCase()] = shortMeaning;
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

export function lookupGloss(token) {
  const clean = token.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
  if (!clean) return null;
  if (state.HEADWORD_MAP[clean]) return state.HEADWORD_MAP[clean];
  if (state.GLOSSARY[clean]) return state.GLOSSARY[clean];
  for (const [pattern, replacement] of DEINFLECT_SUFFIXES) {
    if (pattern.test(clean)) {
      const base = clean.replace(pattern, replacement);
      if (state.HEADWORD_MAP[base]) return state.HEADWORD_MAP[base];
      if (state.GLOSSARY[base]) return state.GLOSSARY[base];
    }
  }
  return null;
}

export function wordsOf(level, category) {
  return allWords()
    .filter((w) => w.level === level && (!category || w.category === category))
    .sort((a, b) => (a.freq || 3) - (b.freq || 3) || a.id - b.id);
}

export function getRecord(wordId) {
  return state.SRS_STATE[wordId] || null;
}

export function ensureRecord(wordId) {
  if (!state.SRS_STATE[wordId]) {
    state.SRS_STATE[wordId] = SRS.createInitialRecord(wordId);
  }
  return state.SRS_STATE[wordId];
}

export function levelStats(level) {
  const words = wordsOf(level);
  const total = words.length;
  let mastered = 0;
  for (const w of words) {
    const rec = getRecord(w.id);
    if (rec && SRS.isMastered(rec)) mastered++;
  }
  return { total, mastered, percent: total ? mastered / total : 0 };
}

export function isLevelUnlocked() {
  return true;
}

export function allUnlockedWords() {
  let words = [];
  for (const l of state.META.levels) {
    if (isLevelUnlocked(l.level)) {
      words = words.concat(wordsOf(l.level));
    }
  }
  return words;
}

// 이미 한 번 이상 학습한(기록이 있는) 단어만 복습 대상으로 삼는다.
export function reviewedWordsPool() {
  return allUnlockedWords().filter((w) => !!getRecord(w.id));
}

// 박스가 낮은(모르는) 단어일수록 여러 번 포함시켜 더 자주 등장하게 만든다.
export function buildReviewQueue(cap) {
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

export function reviewPoolInfo() {
  const pool = reviewedWordsPool();
  const weakCount = pool.filter((w) => (getRecord(w.id).box || 1) <= 2).length;
  return { total: pool.length, weakCount };
}
