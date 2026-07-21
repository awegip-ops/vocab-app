// 기기 간 진행 상황 동기화 (Firebase Firestore + 익명 인증)
//
// firebase-config.js 에 실제 프로젝트 값을 채우지 않으면 이 모듈의 모든 함수는
// 조용히 비활성 상태로 동작합니다 (isSyncAvailable() === false).
import { firebaseConfig } from "./firebase-config.js?v=2";

const SYNC_CODE_KEY = "vocabApp_syncCode_v1";
const DEVICE_ID_KEY = "vocabApp_deviceId_v1";
const SDK_VERSION = "10.12.2";

const isConfigured =
  !!firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY";

let firebaseModsPromise = null;
let app = null;
let auth = null;
let db = null;
let initPromise = null;
let unsubscribeSnapshot = null;

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function isSyncAvailable() {
  return isConfigured;
}

export function getSyncCode() {
  return localStorage.getItem(SYNC_CODE_KEY);
}

function saveSyncCodeLocal(code) {
  localStorage.setItem(SYNC_CODE_KEY, code);
}

async function loadFirebaseMods() {
  if (!firebaseModsPromise) {
    firebaseModsPromise = Promise.all([
      import(
        /* webpackIgnore: true */ `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`
      ),
      import(
        /* webpackIgnore: true */ `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`
      ),
      import(
        /* webpackIgnore: true */ `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`
      ),
    ]);
  }
  return firebaseModsPromise;
}

async function ensureInit() {
  if (!isConfigured) return false;
  if (db && auth) return true;
  if (!initPromise) {
    initPromise = (async () => {
      const [
        { initializeApp },
        { getAuth, signInAnonymously, onAuthStateChanged },
        firestoreMod,
      ] = await loadFirebaseMods();
      app = initializeApp(firebaseConfig);
      auth = getAuth(app);
      db = firestoreMod.getFirestore(app);
      await new Promise((resolve, reject) => {
        const unsub = onAuthStateChanged(
          auth,
          (user) => {
            if (user) {
              unsub();
              resolve();
            }
          },
          reject
        );
        signInAnonymously(auth).catch((err) => {
          unsub();
          reject(err);
        });
      });
      return true;
    })().catch((e) => {
      console.error("Firebase 초기화 실패", e);
      initPromise = null;
      db = null;
      auth = null;
      return false;
    });
  }
  return initPromise;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0/O, 1/I 제외

function randomCode() {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s;
}

async function firestoreDoc(code) {
  const firestoreMod = (await loadFirebaseMods())[2];
  return { firestoreMod, ref: firestoreMod.doc(db, "syncCodes", code) };
}

// 새 동기화 코드를 만들고, 현재 기기의 상태로 초기화합니다.
export async function createSyncCode(state) {
  const ok = await ensureInit();
  if (!ok) throw new Error("동기화를 사용할 수 없습니다.");
  const code = randomCode();
  const { firestoreMod, ref } = await firestoreDoc(code);
  await firestoreMod.setDoc(ref, {
    ...state,
    updatedAt: firestoreMod.serverTimestamp(),
    updatedBy: getDeviceId(),
  });
  saveSyncCodeLocal(code);
  return code;
}

// 다른 기기에서 만든 코드를 입력해 연결합니다. 연결 직후의 원격 상태를 반환합니다.
export async function linkSyncCode(rawCode) {
  const ok = await ensureInit();
  if (!ok) throw new Error("동기화를 사용할 수 없습니다.");
  const code = rawCode.trim().toUpperCase();
  const { ref } = await firestoreDoc(code);
  const firestoreMod = (await loadFirebaseMods())[2];
  const snap = await firestoreMod.getDoc(ref);
  if (!snap.exists()) throw new Error("존재하지 않는 코드입니다.");
  saveSyncCodeLocal(code);
  return snap.data();
}

// 동기화를 끊습니다 (로컬 데이터는 그대로 유지).
export function stopSync() {
  localStorage.removeItem(SYNC_CODE_KEY);
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
    unsubscribeSnapshot = null;
  }
}

export async function fetchRemoteState() {
  const code = getSyncCode();
  if (!code || !isConfigured) return null;
  const ok = await ensureInit();
  if (!ok) return null;
  const { ref } = await firestoreDoc(code);
  const firestoreMod = (await loadFirebaseMods())[2];
  const snap = await firestoreMod.getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

let pushTimer = null;

// 로컬 상태 변경 후 호출하면, 잠시 후(디바운스) 원격에 업로드합니다.
export function schedulePush(getState, onDone) {
  const code = getSyncCode();
  if (!code || !isConfigured) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const ok = await ensureInit();
    if (!ok) return;
    try {
      const { firestoreMod, ref } = await firestoreDoc(code);
      await firestoreMod.setDoc(
        ref,
        {
          ...getState(),
          updatedAt: firestoreMod.serverTimestamp(),
          updatedBy: getDeviceId(),
        },
        { merge: true }
      );
      if (onDone) onDone();
    } catch (e) {
      console.error("동기화 업로드 실패", e);
    }
  }, 1200);
}

// 다른 기기가 원격 상태를 바꾸면 실시간으로 onRemoteState(data)를 호출합니다.
export async function subscribeRemoteChanges(onRemoteState) {
  const code = getSyncCode();
  if (!code || !isConfigured) return;
  const ok = await ensureInit();
  if (!ok) return;
  const { firestoreMod, ref } = await firestoreDoc(code);
  if (unsubscribeSnapshot) unsubscribeSnapshot();
  unsubscribeSnapshot = firestoreMod.onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.updatedBy === getDeviceId()) return; // 내가 방금 올린 변경은 무시
    onRemoteState(data);
  });
}
