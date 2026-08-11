import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    publicDir: false,
    build: { outDir: 'public' },
    server: {
      proxy: {
        '/api': {
          target: `http://localhost:${env.PORT || 3000}`,
        },
      },
    },
  };
})
