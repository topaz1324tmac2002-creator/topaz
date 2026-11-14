import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const el = document.getElementById('root')
if (!el) throw new Error('#root not found')

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA — 오프라인 앱 셸 서비스 워커.
// 프로덕션 빌드에서만 등록한다(개발 서버의 HMR 자산이 캐시에 남지 않도록).
// './sw.js'는 base: './' 덕분에 GitHub Pages 하위 경로(/topaz/)에서도 올바르게 풀린다.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .catch((err) => console.warn('[PWA] 서비스 워커 등록 실패:', err))
  })
}
