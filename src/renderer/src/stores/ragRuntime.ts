/**
 * RAG 运行时状态管理
 * 使用 EventEmitter 模式 + useSyncExternalStore 兼容
 * 解决模块级变量不会触发 React 渲染的问题
 */

export type PdfInfo = { pdfId: string; filePath: string } | null

let current: PdfInfo = null
const listeners = new Set<() => void>()

export function setCurrentPdfForRAG(pdfId: string, filePath: string) {
  current = { pdfId, filePath }
  console.log('[RAG Runtime] 设置当前PDF:', pdfId, filePath)
  listeners.forEach((l) => l())
}

export function getCurrentPdfForRAG(): PdfInfo {
  return current
}

export function subscribeCurrentPdfForRAG(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
