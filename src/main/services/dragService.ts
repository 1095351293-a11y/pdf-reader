import { ipcMain, BrowserWindow } from 'electron'

// 存储拖放文件路径
let draggedFilePaths: string[] = []

export function registerDragService(): void {
  // 暴露给渲染进程获取拖放文件
  ipcMain.handle('drag:getFiles', () => {
    const paths = [...draggedFilePaths]
    draggedFilePaths = [] // 清空，防止重复
    return paths
  })
}

export function handleDragEvent(win: BrowserWindow, event: 'drag-enter' | 'drag-over' | 'drag-leave' | 'drop', paths: string[]): void {
  if (event === 'drop') {
    draggedFilePaths = paths.filter((p) => p.toLowerCase().endsWith('.pdf'))
    if (draggedFilePaths.length > 0) {
      win.webContents.send('drag:filesDropped', draggedFilePaths)
    }
  }
}
