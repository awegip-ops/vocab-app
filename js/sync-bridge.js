// 로컬 상태 <-> Firebase 동기화(js/sync.js) 사이를 잇는 앱 레벨 로직.
// js/sync.js 자체는 Firestore 통신만 담당하고, 여기서는 "로컬 상태를 어떻게
// 모으고 원격 상태를 어떻게 병합할지"를 다룹니다.
import { state, rebuildHeadwordMap } from "./state.js?v=1";
import * as Storage from "./storage.js";
import * as Sync from "./sync.js?v=2";
import { isListening } from "./tts.js?v=1";
import { renderHome, renderStats } from "./views.js?v=1";

export function collectLocalState() {
  return {
    srsState: state.SRS_STATE,
    streak: state.STREAK,
    customWords: state.CUSTOM_WORDS,
  };
}

// 원격 상태를 로컬에 병합합니다. 단어별 reviewCount(복습 누적 횟수)가
// 더 높은 쪽을 "더 진행된" 기록으로 간주해 충돌 없이 합칩니다.
export function mergeRemoteState(remote) {
  if (!remote) return false;
  let changed = false;

  if (remote.srsState) {
    for (const [wid, rrec] of Object.entries(remote.srsState)) {
      const lrec = state.SRS_STATE[wid];
      if (!lrec || (rrec.reviewCount || 0) > (lrec.reviewCount || 0)) {
        state.SRS_STATE[wid] = rrec;
        changed = true;
      }
    }
    if (changed) Storage.saveSrsState(state.SRS_STATE);
  }

  if (remote.customWords && remote.customWords.length) {
    const added = Storage.appendCustomWords(remote.customWords);
    if (added) {
      state.CUSTOM_WORDS = Storage.loadCustomWords();
      rebuildHeadwordMap();
      changed = true;
    }
  }

  if (remote.streak) {
    const localDate = state.STREAK.lastActiveDate;
    const remoteDate = remote.streak.lastActiveDate;
    if (!localDate || (remoteDate && remoteDate > localDate)) {
      state.STREAK = remote.streak;
      Storage.saveStreak(state.STREAK);
      changed = true;
    } else if (remoteDate === localDate && (remote.streak.count || 0) > (state.STREAK.count || 0)) {
      state.STREAK = { ...state.STREAK, count: remote.streak.count };
      Storage.saveStreak(state.STREAK);
      changed = true;
    }
  }

  return changed;
}

export function refreshIfIdle() {
  if (state.currentSession || isListening()) return; // 학습/듣기 중에는 화면을 건드리지 않음
  if (state.currentView === "home") renderHome();
  else if (state.currentView === "stats") renderStats();
}

export async function initSync() {
  if (!Sync.isSyncAvailable() || !Sync.getSyncCode()) return;
  state.syncStatus.state = "syncing";
  try {
    const remote = await Sync.fetchRemoteState();
    mergeRemoteState(remote);
    state.syncStatus = { state: "synced", lastSyncedAt: new Date(), error: null };
    refreshIfIdle();
    Sync.subscribeRemoteChanges((data) => {
      if (mergeRemoteState(data)) refreshIfIdle();
      state.syncStatus = { state: "synced", lastSyncedAt: new Date(), error: null };
      if (state.currentView === "stats") renderStats();
    });
  } catch (e) {
    state.syncStatus = { state: "error", lastSyncedAt: state.syncStatus.lastSyncedAt, error: e.message };
  }
}

export function syncPush() {
  if (!Sync.getSyncCode()) return;
  state.syncStatus.state = "syncing";
  Sync.schedulePush(collectLocalState, () => {
    state.syncStatus = { state: "synced", lastSyncedAt: new Date(), error: null };
    if (state.currentView === "stats") renderStats();
  });
}
