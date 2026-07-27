/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the API. Leave empty in development so requests go through the
   * Vite proxy configured in vite.config.ts.
   */
  readonly VITE_API_SERVER?: string;
  /** Milliseconds between packet-list refreshes while a capture is running. */
  readonly VITE_POLL_INTERVAL_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
