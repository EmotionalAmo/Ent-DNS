import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  server: {
    host: '0.0.0.0', // 允许局域网/外网访问
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        ws: true, // 同时代理 WebSocket（/api/v1/ws/query-log）
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),   // Tailwind v4 官方 Vite 插件，正确处理 @theme inline 和工具类
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
