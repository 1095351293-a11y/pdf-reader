import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import type { Plugin } from 'vite'

// Vite 插件：解决 Electron + Vite 环境下 pdf.js Worker 加载问题
//
// 问题：pdfjs-dist 4.x 的 Worker 是 .mjs 文件，
// Vite dev server 返回 text/html MIME，Blob URL 因跨源走 createCDNWrapper 也失败。
//
// 方案：将 worker 代码内联到虚拟模块，运行时创建 Blob URL + module Worker，
// 然后通过 workerPort 传给 pdf.js，完全绕过 pdf.js 内部的 Worker 创建逻辑。
function pdfWorkerInline(): Plugin {
  const virtualModuleId = 'virtual:pdf-worker-src'
  const resolvedVirtualModuleId = '\0' + virtualModuleId

  return {
    name: 'pdf-worker-inline',
    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId
      }
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        const workerPath = resolve(
          __dirname,
          'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'
        )
        const content = readFileSync(workerPath, 'utf-8')

        // 导出 worker 代码字符串和创建 Worker 的辅助函数
        // 去掉 export 语句，使 worker 代码可作为经典脚本加载
        const stripped = content.replace(/export\s*\{[^}]*\}\s*;?\s*$/, '')
        return `const workerCode = ${JSON.stringify(stripped)}; export { workerCode };`
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['@opendataloader/pdf']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), pdfWorkerInline()],
    optimizeDeps: {
      include: ['pdfjs-dist']
    }
  }
})
