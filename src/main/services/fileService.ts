import { ipcMain } from 'electron'
import { initDatabase, getDatabase } from '../db'

export function registerFileService(): void {
  initDatabase()
  const db = getDatabase()

  // 获取文件树
  ipcMain.handle('file:getTree', () => {
    const rows = db.prepare('SELECT * FROM files WHERE is_deleted = 0 ORDER BY sort_order').all()
    return rows
  })

  // 添加文件/文件夹
  ipcMain.handle('file:add', (_, node: any) => {
    const stmt = db.prepare(`
      INSERT INTO files (id, name, type, path, parent_id, sort_order, created_at)
      VALUES (@id, @name, @type, @path, @parentId, @sortOrder, @createdAt)
    `)
    stmt.run({
      id: node.id,
      name: node.name,
      type: node.type,
      path: node.path || null,
      parentId: node.parentId || null,
      sortOrder: node.sortOrder || 0,
      createdAt: Date.now(),
    })
    return node.id
  })

  // 重命名
  ipcMain.handle('file:rename', (_, { id, name }: { id: string; name: string }) => {
    db.prepare('UPDATE files SET name = ? WHERE id = ?').run(name, id)
    return true
  })

  // 移动节点
  ipcMain.handle('file:move', (_, { id, parentId, sortOrder }: { id: string; parentId: string; sortOrder: number }) => {
    db.prepare('UPDATE files SET parent_id = ?, sort_order = ? WHERE id = ?').run(parentId || null, sortOrder, id)
    return true
  })

  // 移动到回收站
  ipcMain.handle('file:delete', (_, id: string) => {
    db.prepare('UPDATE files SET is_deleted = 1, deleted_at = ? WHERE id = ?').run(Date.now(), id)
    return true
  })

  // 恢复
  ipcMain.handle('file:restore', (_, id: string) => {
    db.prepare('UPDATE files SET is_deleted = 0, deleted_at = NULL WHERE id = ?').run(id)
    return true
  })

  // 永久删除
  ipcMain.handle('file:permanentDelete', (_, id: string) => {
    db.prepare('DELETE FROM files WHERE id = ?').run(id)
    return true
  })

  // 获取回收站内容
  ipcMain.handle('file:getTrash', () => {
    return db.prepare('SELECT * FROM files WHERE is_deleted = 1').all()
  })

  // 搜索文件
  ipcMain.handle('file:search', (_, query: string) => {
    return db.prepare("SELECT * FROM files WHERE is_deleted = 0 AND name LIKE ?").all(`%${query}%`)
  })
}
