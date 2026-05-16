import { useCallback, forwardRef, useState, useRef, useEffect } from 'react'
import { FileUp, ChevronLeft, ChevronRight, X, Copy, MessageSquare, Highlighter, Languages, Quote } from 'lucide-react'
import ResizeHandle from '../common/ResizeHandle'
import { useAppStore } from '../../stores/appStore'
import { useFileStore } from '../../stores/fileStore'
import PDFSidePanel from './PDFSidePanel'
import PDFRender, { PDFRenderHandle } from './PDFRender'
import ContextMenu, { MenuItem } from '../common/ContextMenu'
import TranslatePanel from './TranslatePanel'
import CitationPanel from './CitationPanel'
import { setCurrentPdfForRAG, triggerRAGIndex, normalizePathForRAG } from '../chat/ChatPanel'
import type { ContextMenuSelection } from './PDFRender'

// ========== 可拖拽弹窗 Hook ==========
function useDraggable(initialX: number, initialY: number) {
  const posRef = useRef({ x: initialX, y: initialY })
  const [pos, setPos] = useState({ x: initialX, y: initialY })
  const draggingRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = { startX: e.clientX, startY: e.clientY, originX: posRef.current.x, originY: posRef.current.y }

    const onMouseMove = (ev: MouseEvent) => {
      const d = draggingRef.current
      if (!d) return
      const nx = d.originX + (ev.clientX - d.startX)
      const ny = d.originY + (ev.clientY - d.startY)
      posRef.current = { x: Math.max(0, nx), y: Math.max(0, ny) }
      setPos(posRef.current)
    }
    const onMouseUp = () => {
      draggingRef.current = null
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [])

  return { pos, onDragStart }
}

// ========== 可拖拽弹窗容器 ==========
function DraggablePopup({
  initialX,
  initialY,
  title,
  onClose,
  children,
}: {
  initialX: number
  initialY: number
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const { pos, onDragStart } = useDraggable(
    Math.min(initialX, window.innerWidth - 280),
    Math.min(initialY, window.innerHeight - 200)
  )

  return (
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 9999,
        minWidth: 240,
      }}
    >
      <div className="bg-dark-800 border border-dark-500 rounded-lg shadow-2xl overflow-hidden">
        {/* 可拖拽标题栏 */}
        <div
          onMouseDown={onDragStart}
          className="flex items-center justify-between px-3 py-2 bg-dark-700/50 border-b border-dark-500 cursor-grab active:cursor-grabbing select-none"
        >
          <span className="text-xs text-dark-200 font-medium">{title}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onClose() }}
            onMouseDown={(e) => e.stopPropagation()}
            className="text-dark-400 hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// 批注输入弹窗状态
interface PendingAnnotation {
  id: string
  pageIndex: number
  text: string
  color: string
  rects: { x: number; y: number; width: number; height: number }[]
  screenPos: { x: number; y: number } // 弹窗显示位置（屏幕坐标）
}

// 包装组件：从 store 订阅 highlightMode，避免 PDFRender 拿到固定值
const PDFRenderWithStore = forwardRef<PDFRenderHandle, {
  filePath: string
  pageNumber: number
  scale: number
  onPageCount?: (count: number) => void
  onPageChange?: (page: number) => void
  onScaleChange?: (scale: number) => void
}>(function PDFRenderWithStore(props, ref) {
  const highlightMode = useAppStore((s) => s.highlightMode)
  const annotations = useAppStore((s) => s.annotations)
  const addAnnotation = useAppStore((s) => s.addAnnotation)
  const updateAnnotation = useAppStore((s) => s.updateAnnotation)
  const removeAnnotation = useAppStore((s) => s.removeAnnotation)
  const setPendingAttachment = useAppStore((s) => s.setPendingAttachment)
  const toggleChatPanel = useAppStore((s) => s.toggleChatPanel)
  const chatPanelVisible = useAppStore((s) => s.chatPanelVisible)
  const startTranslate = useAppStore((s) => s.startTranslate)
  const addCitation = useAppStore((s) => s.addCitation)
  const toggleCitationPanel = useAppStore((s) => s.toggleCitationPanel)
  const defaultCitationFormat = useAppStore((s) => s.defaultCitationFormat)
  const activeTabId = useAppStore((s) => s.activeTabId)

  // 批注输入弹窗
  const [pendingAnnotation, setPendingAnnotation] = useState<PendingAnnotation | null>(null)
  const [noteText, setNoteText] = useState('')
  // 编辑已有批注
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null)

  // 右键菜单状态
  const [contextMenuState, setContextMenuState] = useState<{
    x: number
    y: number
    selection: ContextMenuSelection | null
  } | null>(null)

  const showAnnotationPopup = (text: string, pageIndex: number, rects: { x: number; y: number; width: number; height: number }[]) => {
    if (rects.length === 0) return

    // 计算弹窗屏幕位置
    const selection = window.getSelection()
    let screenPos = { x: 0, y: 0 }
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      const rangeRects = range.getClientRects()
      if (rangeRects.length > 0) {
        const last = rangeRects[rangeRects.length - 1]
        screenPos = { x: last.right + 10, y: last.top }
      }
    }

    const id = `ann-${Date.now()}`
    // 立即添加批注到 store（先高亮显示），note 为空
    addAnnotation({
      id,
      pageIndex,
      text,
      color: '#FFEB3B',
      rects,
      note: '',
      timestamp: Date.now(),
    })
    setPendingAnnotation({
      id,
      pageIndex,
      text,
      color: '#FFEB3B',
      rects,
      screenPos,
    })
    setNoteText('')
    setEditingAnnotationId(null)
  }

  const handleTextSelect = (_text: string, _pageIndex: number, _rects: { x: number; y: number; width: number; height: number }[]) => {
    // 选中文字不再自动弹出批注，批注仅通过右键菜单触发
  }

  // 右键菜单回调
  const handleContextMenu = (e: React.MouseEvent, selection: ContextMenuSelection | null) => {
    setContextMenuState({ x: e.clientX, y: e.clientY, selection })
  }

  // 右键菜单项
  const contextMenuItems: MenuItem[] = contextMenuState?.selection
    ? [
        {
          id: 'copy',
          label: '复制',
          icon: <Copy className="w-3.5 h-3.5" />,
          shortcut: 'Ctrl+C',
          onClick: () => {
            navigator.clipboard.writeText(contextMenuState.selection!.text).catch(() => {})
          },
        },
        {
          id: 'annotate',
          label: '添加批注',
          icon: <Highlighter className="w-3.5 h-3.5" />,
          onClick: () => {
            const s = contextMenuState.selection!
            showAnnotationPopup(s.text, s.pageIndex, s.rects)
          },
        },
        {
          id: 'to-chat',
          label: '发送到AI对话',
          icon: <MessageSquare className="w-3.5 h-3.5" />,
          onClick: () => {
            const s = contextMenuState.selection!
            setPendingAttachment({
              id: `sel-${Date.now()}`,
              type: 'selection',
              label: `选文：${s.text.substring(0, 30)}${s.text.length > 30 ? '...' : ''}`,
              data: s.text,
              pageNumbers: [s.pageIndex + 1],
            })
            if (!chatPanelVisible) toggleChatPanel()
          },
        },
        {
          id: 'translate',
          label: '翻译',
          icon: <Languages className="w-3.5 h-3.5" />,
          onClick: () => {
            const s = contextMenuState.selection!
            startTranslate(s.text)
          },
        },
        {
          id: 'citation',
          label: '添加到引用',
          icon: <Quote className="w-3.5 h-3.5" />,
          onClick: () => {
            const s = contextMenuState.selection!
            const citationId = addCitation({
              pdfId: activeTabId || '',
              pageIndex: s.pageIndex,
              selectedText: s.text,
              contextText: s.text.substring(0, 200),
              rects: s.rects,
              format: defaultCitationFormat,
              formattedCitation: '', // 暂时为空，后续由格式化函数生成
              tags: [],
              isProcessed: false,
            })
            // 打开引用面板
            toggleCitationPanel()
            console.log('已添加引用:', citationId)
          },
        },
      ]
    : [
        {
          id: 'copy',
          label: '复制',
          icon: <Copy className="w-3.5 h-3.5" />,
          shortcut: 'Ctrl+C',
          disabled: true,
          onClick: () => {},
        },
      ]

  const confirmAnnotation = () => {
    if (!pendingAnnotation) return
    // 批注已在 showAnnotationPopup 时添加，这里只需更新 note
    updateAnnotation(pendingAnnotation.id, { note: noteText })
    setPendingAnnotation(null)
    setNoteText('')
    window.getSelection()?.removeAllRanges()
  }

  const cancelAnnotation = () => {
    // 取消时删除已预添加的批注
    if (pendingAnnotation) {
      removeAnnotation(pendingAnnotation.id)
    }
    setPendingAnnotation(null)
    setNoteText('')
    setEditingAnnotationId(null)
    window.getSelection()?.removeAllRanges()
  }

  const saveEditAnnotation = () => {
    if (editingAnnotationId) {
      updateAnnotation(editingAnnotationId, { note: noteText })
    }
    setEditingAnnotationId(null)
    setNoteText('')
  }

  // 当前页面的批注（用于显示侧边批注标记）
  const currentPageAnnotations = annotations.filter(() => true) // 所有页的批注都传给 PDFRender

  return (
    <>
      <PDFRender
        ref={ref}
        filePath={props.filePath}
        pageNumber={props.pageNumber}
        scale={props.scale}
        highlightMode={highlightMode}
        annotations={currentPageAnnotations}
        onTextSelect={handleTextSelect}
        onAnnotationClick={(annId) => {
          const ann = annotations.find((a) => a.id === annId)
          if (ann) {
            setEditingAnnotationId(annId)
            setNoteText(ann.note)
            setPendingAnnotation(null)
          }
        }}
        onRegionScreenshot={(dataUrl, pageIndex) => {
          console.log('[PDFViewer] 区域截图完成', { pageIndex, dataUrlLength: dataUrl?.length })
          
          // 1. 保存到剪贴板
          try {
            const byteString = atob(dataUrl.split(',')[1])
            const mimeType = dataUrl.split(',')[0].match(/:(.*?);/)?.[1] || 'image/png'
            const ab = new ArrayBuffer(byteString.length)
            const ia = new Uint8Array(ab)
            for (let i = 0; i < byteString.length; i++) {
              ia[i] = byteString.charCodeAt(i)
            }
            const blob = new Blob([ab], { type: mimeType })
            const item = new ClipboardItem({ [mimeType]: blob })
            navigator.clipboard.write([item]).catch(() => {})
          } catch {
            // 剪贴板写入失败时静默处理
          }

          // 2. 添加到对话附件
          console.log('[PDFViewer] 设置 pendingAttachment', { chatPanelVisible })
          setPendingAttachment({
            id: `att-${Date.now()}`,
            type: 'screenshot',
            label: `第 ${pageIndex + 1} 页截图`,
            data: dataUrl,
            pageNumbers: [pageIndex + 1],
          })
          if (!chatPanelVisible) {
            console.log('[PDFViewer] 打开对话面板')
            toggleChatPanel()
          }
        }}
        onContextMenu={handleContextMenu}
        onPageCount={props.onPageCount}
        onPageChange={props.onPageChange}
        onScaleChange={props.onScaleChange}
      />

      {/* 新建批注输入弹窗 */}
      {pendingAnnotation && (
        <DraggablePopup
          initialX={pendingAnnotation.screenPos.x}
          initialY={pendingAnnotation.screenPos.y}
          title="添加批注"
          onClose={cancelAnnotation}
        >
          <div className="px-3 pt-2">
            <div className="text-xs text-dark-300 line-clamp-2 bg-dark-900/50 rounded px-2 py-1.5">
              "{pendingAnnotation.text}"
            </div>
          </div>
          <div className="px-3 pt-2">
            <textarea
              autoFocus
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="输入批注内容... (Ctrl+Enter 确认)"
              className="w-full text-xs text-dark-100 bg-dark-900/50 border border-dark-500 rounded px-2 py-1.5 resize-none focus:outline-none focus:border-accent/50 placeholder-dark-400"
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); confirmAnnotation() }
                if (e.key === 'Escape') cancelAnnotation()
              }}
            />
          </div>
          <div className="flex items-center justify-end gap-2 px-3 py-2">
            <button onClick={cancelAnnotation} className="text-xs text-dark-300 hover:text-white px-2.5 py-1 rounded transition-colors">取消</button>
            <button onClick={confirmAnnotation} className="text-xs bg-accent hover:bg-accent/80 text-dark-900 font-medium px-3 py-1 rounded transition-colors">确认</button>
          </div>
        </DraggablePopup>
      )}

      {/* 编辑批注弹窗 */}
      {editingAnnotationId && (
        <DraggablePopup
          initialX={window.innerWidth / 2 - 130}
          initialY={window.innerHeight / 2 - 80}
          title="编辑批注"
          onClose={() => { setEditingAnnotationId(null); setNoteText('') }}
        >
          <div className="px-3 pt-2">
            <textarea
              autoFocus
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="输入批注内容..."
              className="w-full text-xs text-dark-100 bg-dark-900/50 border border-dark-500 rounded px-2 py-1.5 resize-none focus:outline-none focus:border-accent/50 placeholder-dark-400"
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEditAnnotation() }
                if (e.key === 'Escape') { setEditingAnnotationId(null); setNoteText('') }
              }}
            />
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <button
              onClick={() => { removeAnnotation(editingAnnotationId); setEditingAnnotationId(null); setNoteText('') }}
              className="text-xs text-red-400 hover:text-red-300 px-2.5 py-1 rounded transition-colors"
            >
              删除
            </button>
            <div className="flex gap-2">
              <button onClick={() => { setEditingAnnotationId(null); setNoteText('') }} className="text-xs text-dark-300 hover:text-white px-2.5 py-1 rounded transition-colors">取消</button>
              <button onClick={saveEditAnnotation} className="text-xs bg-accent hover:bg-accent/80 text-dark-900 font-medium px-3 py-1 rounded transition-colors">保存</button>
            </div>
          </div>
        </DraggablePopup>
      )}

      {/* 右键菜单 */}
      {contextMenuState && (
        <ContextMenu
          x={contextMenuState.x}
          y={contextMenuState.y}
          items={contextMenuItems}
          onClose={() => setContextMenuState(null)}
        />
      )}
    </>
  )
})

interface PDFViewerProps {
  sidePanel: 'thumbnails' | 'bookmarks' | null
  onCloseSidePanel: () => void
  pdfSidePanelWidth: number
  onResizePdfSidePanel: (delta: number) => void
  pdfRenderRef?: React.Ref<PDFRenderHandle | null>
}

export default function PDFViewer({ sidePanel, onCloseSidePanel, pdfSidePanelWidth, onResizePdfSidePanel, pdfRenderRef }: PDFViewerProps): JSX.Element {
  const { tabs, activeTabId, updateTab } = useAppStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const setPendingAttachment = useAppStore((s) => s.setPendingAttachment)
  const toggleChatPanel = useAppStore((s) => s.toggleChatPanel)
  const chatPanelVisible = useAppStore((s) => s.chatPanelVisible)
  const citationPanelVisible = useAppStore((s) => s.citationPanelVisible)
  const toggleCitationPanel = useAppStore((s) => s.toggleCitationPanel)
  const citationPanelWidth = useAppStore((s) => s.citationPanelWidth)
  const [isDragOver, setIsDragOver] = useState(false)

  // 监听工具栏截图按钮事件
  useEffect(() => {
    const handleCaptureCurrentPage = async () => {
      if (!pdfRenderRef || typeof pdfRenderRef !== 'object' || !pdfRenderRef.current) {
        console.warn('[PDFViewer] pdfRenderRef 不可用')
        return
      }
      
      try {
        const dataUrl = await pdfRenderRef.current.captureScreenshot()
        if (!dataUrl) {
          console.warn('[PDFViewer] 截图失败')
          return
        }
        
        const pageIndex = pdfRenderRef.current.getCurrentPage() - 1
        
        // 保存到剪贴板
        try {
          const byteString = atob(dataUrl.split(',')[1])
          const mimeType = dataUrl.split(',')[0].match(/:(.*?);/)?.[1] || 'image/png'
          const ab = new ArrayBuffer(byteString.length)
          const ia = new Uint8Array(ab)
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i)
          }
          const blob = new Blob([ab], { type: mimeType })
          const item = new ClipboardItem({ [mimeType]: blob })
          navigator.clipboard.write([item]).catch(() => {})
        } catch {
          // 剪贴板写入失败时静默处理
        }

        // 添加到对话附件
        setPendingAttachment({
          id: `att-${Date.now()}`,
          type: 'screenshot',
          label: `第 ${pageIndex + 1} 页截图`,
          data: dataUrl,
          pageNumbers: [pageIndex + 1],
        })
        if (!chatPanelVisible) toggleChatPanel()
      } catch (err) {
        console.error('[PDFViewer] 截图失败:', err)
      }
    }
    
    window.addEventListener('capture-current-page', handleCaptureCurrentPage)
    return () => window.removeEventListener('capture-current-page', handleCaptureCurrentPage)
  }, [pdfRenderRef, chatPanelVisible, toggleChatPanel, setPendingAttachment])

  // 监听整页截图事件（从PDFRender内部触发）
  useEffect(() => {
    const handlePageCaptured = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail) return
      const { dataUrl, pageIndex } = detail
      
      // 保存到剪贴板
      try {
        const byteString = atob(dataUrl.split(',')[1])
        const mimeType = dataUrl.split(',')[0].match(/:(.*?);/)?.[1] || 'image/png'
        const ab = new ArrayBuffer(byteString.length)
        const ia = new Uint8Array(ab)
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i)
        }
        const blob = new Blob([ab], { type: mimeType })
        const item = new ClipboardItem({ [mimeType]: blob })
        navigator.clipboard.write([item]).catch(() => {})
      } catch {
        // 剪贴板写入失败时静默处理
      }

      // 添加到对话附件
      setPendingAttachment({
        id: `att-${Date.now()}`,
        type: 'screenshot',
        label: `第 ${pageIndex + 1} 页截图`,
        data: dataUrl,
        pageNumbers: [pageIndex + 1],
      })
      if (!chatPanelVisible) toggleChatPanel()
    }
    window.addEventListener('page-captured', handlePageCaptured)
    return () => window.removeEventListener('page-captured', handlePageCaptured)
  }, [chatPanelVisible, toggleChatPanel, setPendingAttachment])

  // RAG：当活跃 tab 变化且有 filePath 时，自动加入知识库并触发索引
  useEffect(() => {
    if (activeTab?.filePath) {
      // 使用标准化路径
      const normalizedPath = normalizePathForRAG(activeTab.filePath)
      
      // 1. 设置当前 PDF
      setCurrentPdfForRAG(activeTab.id, normalizedPath)
      
      // 2. 自动加入知识库（用户正在阅读的 PDF）
      const store = useAppStore.getState()
      if (!store.isFileInKnowledgeBase(normalizedPath)) {
        store.toggleKnowledgeBaseFile(normalizedPath)
        console.log(`[RAG] 自动将当前 PDF 加入知识库: ${normalizedPath}`)
      }

      // 3. 延迟触发索引（等待全文提取完成）
      const timer = setTimeout(async () => {
        try {
          // 使用新的 modelConfigs 获取配置
          const { modelConfigs } = useAppStore.getState()
          if (modelConfigs && modelConfigs.length > 0) {
            const defaultConfig = modelConfigs.find((c) => c.isDefault) || modelConfigs[0]
            if (defaultConfig.apiKey) {
              triggerRAGIndex(activeTab.id, normalizedPath, defaultConfig)
            }
          }
        } catch {
          // 索引失败不影响阅读
        }
      }, 2000) // 等待 2 秒让全文提取完成

      return () => clearTimeout(timer)
    } else {
      setCurrentPdfForRAG('', '')
    }
  }, [activeTab?.id, activeTab?.filePath])

  const handlePageCount = useCallback(
    (count: number) => {
      if (activeTabId) updateTab(activeTabId, { totalPages: count })
    },
    [activeTabId, updateTab]
  )

  const handlePageChange = useCallback(
    (page: number) => {
      if (activeTabId) updateTab(activeTabId, { pageNumber: page })
    },
    [activeTabId, updateTab]
  )

  const handleScaleChange = useCallback(
    (newScale: number) => {
      if (activeTabId) updateTab(activeTabId, { scale: newScale })
    },
    [activeTabId, updateTab]
  )

  const goToPage = useCallback(
    (delta: number) => {
      if (!activeTab) return
      const current = activeTab.pageNumber || 1
      const total = activeTab.totalPages || 1
      const next = Math.max(1, Math.min(total, current + delta))
      updateTab(activeTab.id, { pageNumber: next })
    },
    [activeTab, updateTab]
  )

  // 判断是否显示拖放界面（没有activeTab或没有filePath）
  const showDropZone = !activeTab || !activeTab.filePath

  // 监听主进程发送的拖放文件路径（用于PDFViewer空状态）
  useEffect(() => {
    const removeListener = window.api?.on?.('drag:filesDropped', (paths: string[]) => {
      // 只在显示拖放界面时才处理
      const store = useAppStore.getState()
      if ((!store.activeTabId || !store.tabs.find(t => t.id === store.activeTabId)?.filePath) && paths.length > 0) {
        const { addTab } = store
        const firstPath = paths[0]
        const name = firstPath.split(/[\\/]/).pop() || '未命名.pdf'
        const newId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        
        // 添加到资料库（通过fileStore）
        useFileStore.getState().addNode({
          id: newId,
          name,
          type: 'file',
          path: firstPath,
          parentId: 'root1',
          sortOrder: 0,
          createdAt: Date.now(),
        })

        // 打开文件
        addTab({
          id: newId,
          title: name,
          filePath: firstPath,
        })
      }
    })
    return () => removeListener?.()
  }, [])

  if (showDropZone) {
    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
    }

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)

      // 获取拖放的文件路径
      const files = Array.from(e.dataTransfer.files)
      const paths: string[] = []

      files.forEach((file) => {
        if (file.name.toLowerCase().endsWith('.pdf')) {
          const filePath = (file as any).path as string
          if (filePath) {
            paths.push(filePath)
          }
        }
      })

      // 通过主进程处理拖放
      if (paths.length > 0) {
        window.api?.sendDragFiles(paths)
      }
    }

    return (
      <div 
        className={`flex-1 flex items-center justify-center transition-colors ${isDragOver ? 'bg-accent/5' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="text-center space-y-4">
          <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mx-auto transition-colors ${isDragOver ? 'bg-accent/20 ring-2 ring-accent/50' : 'bg-dark-700'}`}>
            <FileUp className={`w-10 h-10 transition-colors ${isDragOver ? 'text-accent' : 'text-dark-300'}`} />
          </div>
          <div className="space-y-1">
            <div className={`text-base font-medium transition-colors ${isDragOver ? 'text-accent' : 'text-dark-200'}`}>
              {isDragOver ? '松开即可导入 PDF' : '拖入 PDF 文件或点击打开'}
            </div>
            <div className="text-dark-300 text-sm">支持拖拽导入、批注、AI 对话等功能</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex min-w-0 min-h-0 bg-dark-900 relative">
      {/* 左侧面板：缩略图 / 目录（仅在有面板时渲染） */}
      {sidePanel && (
        <>
          <PDFSidePanel activePanel={sidePanel} onClose={onCloseSidePanel} width={pdfSidePanelWidth} />
          <ResizeHandle onResize={onResizePdfSidePanel} side="left" />
        </>
      )}

      {/* 主渲染区 */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        <div className="flex-1 min-h-0 relative">
          {activeTab.filePath ? (
            <PDFRenderWithStore
              ref={pdfRenderRef as React.LegacyRef<PDFRenderHandle> | undefined}
              filePath={activeTab.filePath}
              pageNumber={activeTab.pageNumber || 1}
              scale={activeTab.scale || 1.0}
              onPageCount={handlePageCount}
              onPageChange={handlePageChange}
              onScaleChange={handleScaleChange}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="bg-white shadow-2xl rounded-sm" style={{ width: '595px', height: '842px' }}>
                <div className="w-full h-full flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <div className="text-4xl mb-2">📄</div>
                    <div className="text-sm">{activeTab.title}</div>
                    <div className="text-xs mt-1 text-gray-300">PDF 渲染区域</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 页码指示浮层 */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-dark-800/90 backdrop-blur-sm border border-dark-500 rounded-full px-4 py-1.5 flex items-center gap-2 text-xs text-dark-200 shadow-lg z-10">
            <button
              onClick={() => {
                const cur = activeTab.pageNumber || 1
                if (cur > 1) updateTab(activeTab.id, { pageNumber: cur - 1 })
              }}
              className="hover:text-white transition-colors p-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="select-none">
              {activeTab.pageNumber || 1} / {activeTab.totalPages || '-'}
            </span>
            <button
              onClick={() => {
                const cur = activeTab.pageNumber || 1
                const total = activeTab.totalPages || 1
                if (cur < total) updateTab(activeTab.id, { pageNumber: cur + 1 })
              }}
              className="hover:text-white transition-colors p-1"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 翻译面板 */}
        <TranslatePanel />
      </div>

      {/* 引用面板 - 放在最右侧，与左侧边栏对称 */}
      {citationPanelVisible && (
        <>
          <ResizeHandle onResize={(delta) => {}} side="right" />
          <CitationPanel
            onClose={toggleCitationPanel}
            width={citationPanelWidth}
          />
        </>
      )}
    </div>
  )
}
