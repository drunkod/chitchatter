/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  readonly VITE_HOMEPAGE?: string
  readonly VITE_IS_E2E_TEST?: string
  readonly VITE_ENABLE_NOVELLA?: string
  readonly VITE_ENABLE_NOVELLA_DEV?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
