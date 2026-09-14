import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Прокси на бэкенд, а не CORS: браузер ходит по тому же origin, что и dev-сервер,
// и заголовок актора не нужно объяснять преflight-запросом.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Псевдоним @ обязателен для shadcn: компоненты приезжают в исходниках и
    // ссылаются друг на друга через него.
    alias: {'@': fileURLToPath(new URL('./src', import.meta.url))},
  },
  server: {
    // Порт и адрес API — из окружения: параллельные задачи поднимают каждая
    // свой стек (backend/dev/stack.sh), и интерфейс должен смотреть в свой.
    port: Number(process.env.SDLC_UI_PORT ?? 5173),
    proxy: {
      '/v1': {target: process.env.SDLC_API_URL ?? 'http://localhost:8088', changeOrigin: true},
    },
  },
});
