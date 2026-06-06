// sw.js — 아주 단순한 서비스워커 (PWA 설치 + 기본 오프라인 캐시)
// 앱 골격(HTML/CSS/JS/아이콘)을 캐시해 두 번째 방문부터 빠르게 띄웁니다.
// 외부 CDN(Tesseract/Chart/Firebase)과 Firestore 요청은 그냥 네트워크로 통과시킵니다.

const CACHE = "snap-budget-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./icon.svg",
  "./manifest.webmanifest",
  "./src/main.js",
  "./src/ocr.js",
  "./src/parse.js",
  "./src/categorize.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // 같은 출처(우리 앱 파일)만 캐시 우선, 나머지는 네트워크
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
