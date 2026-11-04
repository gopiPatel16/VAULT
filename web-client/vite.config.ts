import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The site is always served from the same origin as the API (the edge server
// in `edge/`, or Caddy in deployment), so requests are relative and CORS never
// enters the picture.
export default defineConfig({
  plugins: [react()],
  server: { host: 'localhost', port: 5174, strictPort: true },
  build: { sourcemap: false },
});
