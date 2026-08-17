import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import extensionManifest from './public/manifest.json';

export default defineConfig({
  plugins: [react()],
  define: {
    __SHIDEA_EXTENSION_VERSION__: JSON.stringify(extensionManifest.version),
    __SHIDEA_RELEASE_DATE__: JSON.stringify(new Date().toISOString()),
  },
  server: { port: 5173, proxy: { '/v1': 'http://127.0.0.1:8787' } },
});
