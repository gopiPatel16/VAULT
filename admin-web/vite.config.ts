import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Bound to loopback on purpose. The administrator console is not a public
// surface; in deployment it is served on a private network or over an overlay
// like Tailscale, never alongside the client-facing hostname.
export default defineConfig({
  plugins: [react()],
  server: { host: 'localhost', port: 5173, strictPort: true },
  build: { sourcemap: false },
});
