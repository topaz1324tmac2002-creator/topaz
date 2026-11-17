/* 김영훈의 주얼리 스튜디오 — 오프라인 앱 셸 서비스 워커
 *
 * GitHub Pages 프로젝트 사이트(https://…github.io/topaz/)처럼 하위 경로에 올라가도
 * 깨지지 않도록, 모든 경로를 이 워커의 scope 기준 상대 경로로 계산한다.
 *  - 탐색(navigation) 요청: 네트워크 우선 → 실패하면 캐시된 index.html
 *  - 그 밖의 같은 scope 정적 자산: stale-while-revalidate (캐시 즉시 응답 + 백그라운드 갱신)
 */
const VERSION = 'topaz-v5'
const CACHE = `topaz-shell-${VERSION}`
const CACHE_PREFIX = 'topaz-shell-'

// 앱 셸: scope 기준 상대 경로
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
]

const scopeUrl = () => new URL(self.registration.scope)
const abs = (path) => new URL(path, self.registration.scope).toString()

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // 한 항목이 실패해도(예: 일시적 404) 설치는 끝나도록 개별 처리
      await Promise.all(
        SHELL.map(async (path) => {
          try {
            await cache.add(new Request(abs(path), { cache: 'reload' }))
          } catch (err) {
            // 다음 방문 때 런타임 캐시가 채운다
          }
        }),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
          .map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

/** 이 워커가 다뤄도 되는 요청인지 (같은 origin · scope 안 · GET) */
function inScope(request, url) {
  if (request.method !== 'GET') return false
  if (url.origin !== self.location.origin) return false
  return url.pathname.startsWith(scopeUrl().pathname)
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone())
    }
    return response
  } catch (err) {
    // 오프라인: 요청한 URL → 앱 셸(index.html) 순으로 캐시 대체
    const cached = (await cache.match(request)) || (await cache.match(abs('./index.html')))
    if (cached) return cached
    throw err
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => undefined)

  if (cached) {
    // 백그라운드 갱신은 응답을 기다리지 않는다
    network.catch(() => {})
    return cached
  }
  const response = await network
  if (response) return response
  if (request.mode === 'navigate') {
    const shell = await cache.match(abs('./index.html'))
    if (shell) return shell
  }
  return new Response('오프라인 상태입니다.', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (!inScope(request, url)) return

  // 개발 편의를 위해 캐시 무효화 쿼리는 건드리지 않는다
  event.respondWith(request.mode === 'navigate' ? networkFirst(request) : staleWhileRevalidate(request))
})
