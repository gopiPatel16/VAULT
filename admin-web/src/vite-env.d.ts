/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the API lives. Build-time only — never a user-editable setting. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
