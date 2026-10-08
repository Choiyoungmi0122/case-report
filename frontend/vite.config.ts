import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 기본값은 전과 같다 (3000 → localhost:5000). 실험이 돌아가는 서버 옆에서
// 다른 작업 트리를 띄울 때만 VITE_PORT, VITE_API_TARGET 으로 바꾼다.
const port = Number(process.env.VITE_PORT || 3000)
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:5000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true
      }
    }
  }
})
