// 홈 화면 설치(PWA) 및 오프라인 사용을 위한 서비스 워커.
// 네트워크 우선 + 캐시 폴백: 온라인이면 항상 최신 파일을 받고, 오프라인이면
// 마지막으로 받아둔 캐시로 동작합니다.

// 주의: CORE_ASSETS의 버전 쿼리스트링(?v=)은 각 파일을 실제로 import/참조하는
// 곳(index.html의 <link>/<script> 태그, js/*.js 파일 상단의 import 문)에 적힌
// 값과 항상 동일해야 합니다. 그 중 하나라도 바꾸면 CACHE_VERSION도 함께 올려서
// 이전 버전이 섞인 캐시를 전부 폐기하세요. (버전이 어긋나면 프리캐시 항목이
// 실제 요청 URL과 매칭되지 않아 캐시 무효화가 되지 않는 채로 쌓입니다.)
const CACHE_VERSION = "v4";
const CACHE_NAME = `vocab-cache-${CACHE_VERSION}`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css?v=13",
  "./js/app.js?v=14",
  "./js/state.js?v=1",
  "./js/utils.js?v=1",
  "./js/dom.js?v=1",
  "./js/ui.js?v=1",
  "./js/sync-bridge.js?v=1",
  "./js/tts.js?v=1",
  "./js/views.js?v=1",
  "./js/study.js?v=1",
  "./js/srs.js",
  "./js/storage.js",
  "./js/sync.js?v=2",
  "./js/firebase-config.js?v=2",
  "./data/words.json",
  "./data/glossary.json",
  "./data/meta.json",
  "./icons/icon-16.png",
  "./icons/icon-32.png",
  "./icons/icon-48.png",
  "./icons/icon-64.png",
  "./icons/icon-128.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.ico",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
