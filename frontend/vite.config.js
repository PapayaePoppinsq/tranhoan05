import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.VITE_BACKEND_TARGET || 'http://127.0.0.1:4311';
export default defineConfig({ plugins: [react()], server: { host: '127.0.0.1', port: 5173, strictPort: true,
  proxy: { '/api': target, '/upload-court-photo': target }, }, });
