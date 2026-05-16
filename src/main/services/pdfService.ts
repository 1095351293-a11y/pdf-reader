import { ipcMain } from 'electron'
import { getDatabase } from '../db'

export function registerPDFService(): void {
  const db = getDatabase()

  // 保存 PDF 文档信息
  ipcMain.handle('pdf:save', (_, doc: any) => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO pdf_documents
      (id, file_id, file_path, total_pages, current_page, scale, reading_progress, page_mapping, bookmarks, annotations, system_prompt, updated_at)
      VALUES (@id, @fileId, @filePath, @totalPages, @currentPage, @scale, @readingProgress, @pageMapping, @bookmarks, @annotations, @systemPrompt, @updatedAt)
    `)
    stmt.run({
      id: doc.id,
      fileId: doc.fileId,
      filePath: doc.filePath,
      totalPages: doc.totalPages || null,
      currentPage: doc.currentPage || 1,
      scale: doc.scale || 1.0,
      readingProgress: doc.readingProgress || 0,
      pageMapping: doc.pageMapping ? JSON.stringify(doc.pageMapping) : null,
      bookmarks: doc.bookmarks ? JSON.stringify(doc.bookmarks) : null,
      annotations: doc.annotations ? JSON.stringify(doc.annotations) : null,
      systemPrompt: doc.systemPrompt || null,
      updatedAt: Date.now(),
    })
    return doc.id
  })

  // 获取 PDF 文档信息
  ipcMain.handle('pdf:get', (_, id: string) => {
    const row = db.prepare('SELECT * FROM pdf_documents WHERE id = ?').get(id) as any
    if (!row) return null
    return {
      ...row,
      pageMapping: row.page_mapping ? JSON.parse(row.page_mapping) : undefined,
      bookmarks: row.bookmarks ? JSON.parse(row.bookmarks) : undefined,
      annotations: row.annotations ? JSON.parse(row.annotations) : undefined,
    }
  })

  // 更新阅读进度
  ipcMain.handle('pdf:updateProgress', (_, { id, currentPage, progress }: { id: string; currentPage: number; progress: number }) => {
    db.prepare('UPDATE pdf_documents SET current_page = ?, reading_progress = ?, updated_at = ? WHERE id = ?')
      .run(currentPage, progress, Date.now(), id)
    return true
  })
}
