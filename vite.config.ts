import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// Прокси на бэкенд, а не CORS: браузер ходит по тому же origin, что и dev-сервер,
// и заголовок актора не нужно объяснять преflight-запросом.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/v1': {target: process.env.SDLC_API_URL ?? 'http://localhost:8088', changeOrigin: true},
    },
  },
});
