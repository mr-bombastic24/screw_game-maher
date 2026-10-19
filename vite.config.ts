import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// أثناء التطوير: الواجهة على 3000 والسيرفر على 8787، وكل طلبات /api تتحول للسيرفر.
const api = { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true } };

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    proxy: api,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    proxy: api,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/react/')) return 'react-vendor';
          return undefined;
        },
      },
    },
  },
});
