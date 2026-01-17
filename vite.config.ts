import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/theme': path.resolve(__dirname, '../src/theme'),
      '@/HelperFunctions': path.resolve(__dirname, '../src/HelperFunctions'),
      '@/mod_temp_bir': path.resolve(__dirname, '../src/mod_temp_bir'),
      '@/models': path.resolve(__dirname, '../src/models'),
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
});
