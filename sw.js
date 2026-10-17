// sw.js — 아주 단순한 서비스워커 (PWA 설치 + 기본 오프라인 캐시)
// 앱 골격(HTML/CSS/JS/아이콘)을 캐시해 두 번째 방문부터 빠르게 띄웁니다.
// 외부 CDN(Tesseract/Chart/Firebase)과 Firestore 요청은 그냥 네트워크로 통과시킵니다.

const CACHE = "hj-budget-v21";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./manifest.webmanifest",
  "./src/main.js",
  "./src/dom.js",
  "./src/datefmt.js",
  "./src/entryops.js",
  "./src/id.js",
  "./src/household.js",
  "./src/renderer.js",
  "./src/aggregate.js",
  "./src/categorize.js",
  "./src/capture.js",
  "./src/capmerge.js",
  "./src/ocr.js",
  "./src/parse.js",
  "./src/firebase-config.js",
  "./src/firebase.js",
  "./src/auth.js",
  "./src/store.js",
];

// 브라우저 HTTP 캐시(GitHub Pages는 10분)를 거치지 않고 서버의 최신 파일을 받음.
// 거치면 배포 직후 옛 모듈과 새 모듈이 섞여 불러와져(서로 없는 export를 찾다가) 앱이 통째로 멈출 수 있음
const FRESH = { cache: "no-cache" };

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, FRESH))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // GET만 캐시 대상 (cache.put은 POST 등 비-GET 요청에서 예외를 던짐)
  if (e.request.method !== "GET") return;
  // 같은 출처(우리 앱 파일)만 처리, 외부 CDN/Firestore는 그냥 통과
  if (url.origin !== location.origin) return;
  // 네트워크 우선: 항상 최신을 받아오고(HTTP 캐시도 서버에 확인), 오프라인일 때만 캐시로 대체
  e.respondWith(
    fetch(e.request, FRESH)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
