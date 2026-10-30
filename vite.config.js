import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:5000', changeOrigin: true } },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules') && /[\\/]recharts[\\/]/.test(id)) return 'charts';
          if (id.includes('node_modules') && /[\\/]d3-[^\\/]+[\\/]/.test(id)) return 'chart-data';
          if (id.includes('node_modules') && /[\\/]framer-motion[\\/]|[\\/]motion-[^\\/]+[\\/]/.test(id)) return 'motion';
        },
      },
    },
  },
});
