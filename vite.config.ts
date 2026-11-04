import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 浏览器直连 MeiCode 的 A2A 服务会被 CORS 拦下（服务端不带 CORS 头），
// 开发期一律走 Vite 代理；目标地址可用 MEICODE_A2A 覆盖。
const target = process.env.MEICODE_A2A ?? 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    proxy: {
      '/a2a': { target, changeOrigin: true },
      '/health': { target, changeOrigin: true },
      '/.well-known': { target, changeOrigin: true },
    },
  },
})
