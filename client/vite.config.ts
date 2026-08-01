import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, proxy Socket.IO to the backend on :3001 so the client can use a
// same-origin socket connection during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
});
