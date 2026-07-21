// localStorage 저장 래퍼
const STATE_KEY = "vocabApp_srsState_v1";
const STREAK_KEY = "vocabApp_streak_v1";
const CUSTOM_WORDS_KEY = "vocabApp_customWords_v1";

export function loadSrsState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("Failed to load SRS state", e);
    return {};
  }
}

export function saveSrsState(state) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

export function loadStreak() {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    return raw ? JSON.parse(raw) : { count: 0, lastActiveDate: null, todayReviewed: 0 };
  } catch (e) {
    return { count: 0, lastActiveDate: null, todayReviewed: 0 };
  }
}

export function saveStreak(streak) {
  localStorage.setItem(STREAK_KEY, JSON.stringify(streak));
}

export function touchStreak() {
  const streak = loadStreak();
  const today = new Date().toISOString().slice(0, 10);
  if (streak.lastActiveDate === today) {
    return streak;
  }
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (streak.lastActiveDate === yesterday) {
    streak.count += 1;
  } else {
    streak.count = 1;
  }
  streak.lastActiveDate = today;
  streak.todayReviewed = 0;
  saveStreak(streak);
  return streak;
}

export function incrementTodayReviewed() {
  const streak = loadStreak();
  const today = new Date().toISOString().slice(0, 10);
  if (streak.lastActiveDate !== today) {
    streak.lastActiveDate = today;
    streak.todayReviewed = 0;
  }
  streak.todayReviewed = (streak.todayReviewed || 0) + 1;
  saveStreak(streak);
  return streak;
}

export function loadCustomWords() {
  try {
    const raw = localStorage.getItem(CUSTOM_WORDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function saveCustomWords(words) {
  localStorage.setItem(CUSTOM_WORDS_KEY, JSON.stringify(words));
}

export function appendCustomWords(newWords) {
  const existing = loadCustomWords();
  const existingIds = new Set(existing.map((w) => w.id));
  const merged = existing.slice();
  let added = 0;
  for (const w of newWords) {
    if (!existingIds.has(w.id)) {
      merged.push(w);
      existingIds.add(w.id);
      added++;
    }
  }
  saveCustomWords(merged);
  return added;
}
