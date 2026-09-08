import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // With the proxy in place VITE_API_SERVER can stay empty in development, so
    // the browser makes same-origin requests and CORS never comes into play.
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/auth': { target: 'http://localhost:8080', changeOrigin: true },
      // The user guide is served BY THE API, behind its own session cookie, and
      // is deliberately not in `public/` where this dev server (and nginx) would
      // hand it out unauthenticated. Proxied so development exercises the same
      // gate production does rather than a second one that can drift.
      '/user-guide': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    outDir: 'build',
    sourcemap: true,
    rollupOptions: {
      output: {
        // No manualChunks. Routes are lazy-loaded in App.tsx, so Rollup's own
        // dependency analysis splits along those boundaries — which is what puts
        // Material React Table only in the chunks that render a table, and
        // @mui/x-charts only in the dashboard chunk.
        //
        // An earlier "everything from node_modules into one vendor chunk" rule
        // undid exactly that: it produced a single blob the login page had to
        // download in full before it could paint.
        //
        // Shared framework code is split by hand because it is on every route, so
        // a stable file name keeps it cached across deploys. Grouping React and
        // MUI together avoids the circular-chunk warning they produce when split
        // from each other.
        //
        // `advancedChunks` rather than `manualChunks`, because vite 8 bundles
        // with rolldown and rolldown takes only the *function* form of
        // `manualChunks`. The object form that used to be here became a type
        // error rather than being silently ignored, which is the good outcome —
        // ignored, it would have meant no framework chunk at all.
        //
        // Measured rather than assumed, since this rewrite could quietly undo
        // what the paragraph above is about. The entry still costs what it did:
        // ~1.01 MB across index + framework + a shared chunk, against ~1.02 MB
        // as index + framework under vite 7. The route chunks that matter —
        // DataGrid, DashboardPage — are still separate and still lazy, so the
        // login page is not downloading the tables and the charts.
        advancedChunks: {
          groups: [
            {
              name: 'framework',
              test: /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|@mui[\\/]material|@emotion[\\/](react|styled))[\\/]/,
            },
          ],
        },
      },
    },
  },
});
