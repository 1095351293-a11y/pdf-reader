import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// 兜底：确保 window.api 存在
if (!window.api) {
  console.warn('window.api not found, creating mock')
  ;(window as any).api = {
    openFile: async () => [],
    openDirectory: async () => null,
    openExternal: async () => {},
    showItemInFolder: async () => {},
    getAppPath: async () => '',
    readFileBuffer: async () => new ArrayBuffer(0),
    file: {
      getTree: async () => [],
      add: async () => '',
      rename: async () => true,
      delete: async () => true,
      restore: async () => true,
      permanentDelete: async () => true,
      getTrash: async () => [],
      search: async () => [],
    },
    pdf: {
      save: async () => '',
      get: async () => null,
      updateProgress: async () => true,
    },
    ai: {
      saveConfigs: async () => true,
      loadConfigs: async () => null,
      testConnection: async () => ({ success: false, message: '' }),
      chat: async () => ({ success: false, message: '' }),
    },
    appSettings: {
      get: async () => null,
      set: async () => true,
    },
    sendDragFiles: () => {},
    on: () => () => {},
  }
}

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element not found')
}

ReactDOM.createRoot(root).render(<App />)
