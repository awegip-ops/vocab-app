// 앱 진입점: 데이터 로드, 전역 에러 복구, 각 모듈 초기 배선만 담당합니다.
// 렌더링은 views.js/study.js/tts.js, 상태는 state.js, 동기화는 sync-bridge.js 참고.
import * as Storage from "./storage.js";
import { state, rebuildHeadwordMap } from "./state.js?v=1";
import { renderHome } from "./views.js?v=1";
import { initSync } from "./sync-bridge.js?v=1";
import { toast } from "./ui.js?v=1";

async function init() {
  const [wordsRes, metaRes, glossaryRes] = await Promise.all([
    fetch("data/words.json"),
    fetch("data/meta.json"),
    fetch("data/glossary.json"),
  ]);
  state.BASE_WORDS = await wordsRes.json();
  state.META = await metaRes.json();
  state.GLOSSARY = await glossaryRes.json();
  state.CUSTOM_WORDS = Storage.loadCustomWords();
  state.SRS_STATE = Storage.loadSrsState();
  state.STREAK = Storage.touchStreak();
  rebuildHeadwordMap();
  renderHome();
  initSync();
}

// 렌더링/이벤트 처리 중 예상 못한 예외가 나면 흰 화면으로 멈추는 대신
// 홈 화면으로 복귀시켜 최소한의 사용성을 지킵니다.
function recoverToHome(err) {
  console.error("Unhandled error", err);
  try {
    toast("문제가 발생했습니다. 홈 화면으로 돌아갑니다.");
    state.currentSession = null;
    renderHome();
  } catch (_) {
    // 복구 자체가 실패하면 더 손쓸 수 없으므로 조용히 포기합니다.
  }
}

window.addEventListener("error", (e) => recoverToHome(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => recoverToHome(e.reason));

init();
