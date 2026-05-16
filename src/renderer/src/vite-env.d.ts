/// <reference types="vite/client" />

// 声明虚拟模块类型
declare module 'virtual:pdf-worker-src' {
  export const workerCode: string
}

interface ImportMetaEnv {
  readonly RENDERER_VITE_API_BASE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
