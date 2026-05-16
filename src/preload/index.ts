import { contextBridge, ipcRenderer } from 'electron'

// 通过 contextBridge 暴露安全的 API 给渲染进程
const api = {
  // 文件对话框
  openFile: (): Promise<string[]> => ipcRenderer.invoke('dialog:openFile'),
  openDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),

  // Shell 操作
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  showItemInFolder: (path: string): Promise<void> =>
    ipcRenderer.invoke('shell:showItemInFolder', path),

  // 应用路径
  getAppPath: (name: string): Promise<string> => ipcRenderer.invoke('app:getPath', name),

  // 读取 PDF 文件为 ArrayBuffer
  readFileBuffer: (filePath: string): Promise<ArrayBuffer> =>
    ipcRenderer.invoke('fs:readFileBuffer', filePath),

  // 文件服务
  file: {
    getTree: (): Promise<any[]> => ipcRenderer.invoke('file:getTree'),
    add: (node: any): Promise<string> => ipcRenderer.invoke('file:add', node),
    rename: (payload: { id: string; name: string }): Promise<boolean> =>
      ipcRenderer.invoke('file:rename', payload),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('file:delete', id),
    restore: (id: string): Promise<boolean> => ipcRenderer.invoke('file:restore', id),
    permanentDelete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('file:permanentDelete', id),
    getTrash: (): Promise<any[]> => ipcRenderer.invoke('file:getTrash'),
    search: (query: string): Promise<any[]> => ipcRenderer.invoke('file:search', query),
  },

  // PDF 服务
  pdf: {
    save: (doc: any): Promise<string> => ipcRenderer.invoke('pdf:save', doc),
    get: (id: string): Promise<any> => ipcRenderer.invoke('pdf:get', id),
    updateProgress: (payload: { id: string; currentPage: number; progress: number }): Promise<boolean> =>
      ipcRenderer.invoke('pdf:updateProgress', payload),
    toImages: (params: { filePath: string; pages: number[] }): Promise<{ success: boolean; images?: { pageNumber: number; base64: string }[]; message?: string }> =>
      ipcRenderer.invoke('pdf:toImages', params),
  },

  // AI 配置
  ai: {
    testConnection: (config: { provider: string; baseUrl: string; apiKey: string; model: string }): Promise<{ success: boolean; message: string }> =>
      ipcRenderer.invoke('ai:testConnection', config),
    chat: (config: { provider: string; baseUrl: string; apiKey: string; model: string; messages: { role: string; content: string }[] }): Promise<{ success: boolean; content?: string; message?: string }> =>
      ipcRenderer.invoke('ai:chat', config),
    generateTableOfContents: (params: {
      config: { provider: string; baseUrl: string; apiKey: string; model: string }
      pageImages: { pageNumber: number; base64: string }[]
    }): Promise<{ success: boolean; toc?: { title: string; pageNumber: number; level: number }[]; message?: string }> =>
      ipcRenderer.invoke('ai:generateTableOfContents', params),
  },

  // RAG 服务
  rag: {
    indexPdf: (params: {
      pdfId: string
      filePath: string
      elements: { id: number; type: string; page: number; bbox: number[]; text?: string; orderId: number; headingLevel?: number }[]
      config: { provider: string; baseUrl: string; apiKey: string; model: string; embeddingModel?: string }
    }): Promise<{ success: boolean; message: string; chunkCount?: number }> =>
      ipcRenderer.invoke('rag:indexPdf', params),
    search: (params: {
      pdfId: string
      query: string
      config: { provider: string; baseUrl: string; apiKey: string; model: string; embeddingModel?: string }
      topK?: number
    }): Promise<{ success: boolean; message?: string; chunks: { id: string; pageNumber: number; chunkIndex: number; content: string; score: number }[] }> =>
      ipcRenderer.invoke('rag:search', params),
    deleteIndex: (pdfId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('rag:deleteIndex', pdfId),
    getIndexStatus: (pdfId: string): Promise<{ hasIndex: boolean; totalChunks: number; embeddedChunks: number }> =>
      ipcRenderer.invoke('rag:getIndexStatus', pdfId),
    debug: (pdfId: string): Promise<{ total: number; embedded: number }> =>
      ipcRenderer.invoke('rag:debug', pdfId),
    getTopChunks: (pdfId: string, limit?: number): Promise<{ success: boolean; message?: string; chunks: { id: string; pageNumber: number; chunkIndex: number; content: string }[] }> =>
      ipcRenderer.invoke('rag:getTopChunks', pdfId, limit),
    indexPdfWithOpenDataLoader: (params: {
      pdfId: string
      filePath: string
      config: { provider: string; baseUrl: string; apiKey: string; model: string; embeddingModel?: string }
    }): Promise<{ success: boolean; message: string; chunkCount?: number; metadata?: any }> =>
      ipcRenderer.invoke('rag:indexPdfWithOpenDataLoader', params),
    agentQuery: (params: {
      pdfId: string
      query: string
      config: { provider: string; baseUrl: string; apiKey: string; model: string; embeddingModel?: string; webSearchApiKey?: string }
      history?: Array<{ role: 'user' | 'assistant'; content: string }>
      images?: string[] // 新增：图片 base64 data URL 数组
    }): Promise<{ success: boolean; output?: string; message?: string; steps?: any[] }> =>
      ipcRenderer.invoke('rag:agent_query', params),
    parseTOC: (filePath: string): Promise<{ success: boolean; toc?: { title: string; pageNumber: number; level: number }[]; message?: string }> =>
      ipcRenderer.invoke('rag:parseTOC', filePath),
  },

  // 应用设置（通用 KV 存储）
  appSettings: {
    get: (key: string): Promise<string | null> => ipcRenderer.invoke('appSettings:get', key),
    set: (key: string, value: string): Promise<boolean> => ipcRenderer.invoke('appSettings:set', key, value),
  },

  // 目录保存/读取
  toc: {
    save: (params: { filePath: string; toc: Array<{ title: string; pageNumber: number; level: number }>; source: string }): Promise<{ success: boolean; message?: string }> =>
      ipcRenderer.invoke('toc:save', params),
    load: (filePath: string): Promise<{ success: boolean; toc?: Array<{ title: string; pageNumber: number; level: number }>; source?: string; savedAt?: number; message?: string }> =>
      ipcRenderer.invoke('toc:load', filePath),
  },

  // OCR 配置
  ocr: {
    setModel: (modelId: string): Promise<{ success: boolean; message?: string }> =>
      ipcRenderer.invoke('ocr:setModel', modelId),
    getModel: (): Promise<{ modelId: string | null }> =>
      ipcRenderer.invoke('ocr:getModel'),
  },

  // 发送拖放文件路径到主进程
  sendDragFiles: (paths: string[]): void => {
    ipcRenderer.send('renderer:dragDropFiles', paths)
  },

  // 监听主进程事件
  on: (channel: string, callback: (...args: any[]) => void) => {
    const subscription = (_: any, ...args: any[]) => callback(...args)
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (非隔离环境兜底)
  window.api = api
}

export type Api = typeof api
