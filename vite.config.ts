import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' — GitHub Pages 프로젝트 사이트(하위 경로)에서도 그대로 동작하도록 상대 경로 사용
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
  },
  server: {
    host: true,
  },
})
