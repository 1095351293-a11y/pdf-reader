import { BookOpen, ChevronRight, Wand2, Loader2, RefreshCw, Sparkles, X, Bot, Check, Settings, FileText, ScanEye, Save } from 'lucide-react'
import React, { useEffect, useState, useRef } from 'react'
import { useAppStore } from '../../stores/appStore'
import * as pdfjsLib from 'pdfjs-dist'
import { generateTOCViaOCR } from '../../utils/tocGenerator'
import type { ModelConfig } from '../../types'

// ========== 类型定义 ==========
export interface OutlineItemType {
  id: string
  title: string
  page: number
  level: number
  items?: OutlineItemType[]
}

export type JumpCallback = (pageNumber: number) => void

// ========== 缩略图组件 ==========
interface ThumbnailItemProps {
  pageNumber: number
  filePath: string
  onClick: (pageNumber: number) => void
  isActive: boolean
}

const ThumbnailItem = React.forwardRef<HTMLDivElement, ThumbnailItemProps>(
  ({ pageNumber, filePath, onClick, isActive }, ref) => {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const generateThumbnail = async () => {
      try {
        let data: ArrayBuffer | Uint8Array
        if (window.api?.readFileBuffer) {
          data = await window.api.readFileBuffer(filePath)
        } else {
          const resp = await fetch(`file://${filePath}`)
          data = await resp.arrayBuffer()
        }
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data), useSystemFonts: true })
        const pdf = await loadingTask.promise
        const page = await pdf.getPage(pageNumber)
        const viewport = page.getViewport({ scale: 0.5 })
        const canvas = document.createElement('canvas')
        const dpr = window.devicePixelRatio || 1
        canvas.width = viewport.width * dpr
        canvas.height = viewport.height * dpr
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.scale(dpr, dpr)
          await page.render({ canvasContext: ctx, viewport }).promise
          if (!cancelled) {
            setThumbnailUrl(canvas.toDataURL('image/png', 1.0))
          }
        }
        try { pdf.destroy() } catch {}
      } catch (err) {
        console.error('生成缩略图失败:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    generateThumbnail()
    return () => { cancelled = true }
  }, [filePath, pageNumber])

  return (
    <div
      ref={ref}
      onClick={() => onClick(pageNumber)}
      className={`cursor-pointer rounded-lg overflow-hidden transition-all ${
        isActive 
          ? 'ring-2 ring-accent bg-accent/10' 
          : 'hover:bg-dark-700/50'
      }`}
    >
      <div className="relative aspect-[3/4] bg-dark-600 flex items-center justify-center">
        {loading ? (
          <Loader2 className="w-5 h-5 text-dark-400 animate-spin" />
        ) : thumbnailUrl ? (
          <img src={thumbnailUrl} alt={`第 ${pageNumber} 页`} className="w-full h-full object-contain" />
        ) : (
          <FileText className="w-8 h-8 text-dark-400" />
        )}
      </div>
      <div className="text-center py-1 text-[10px] text-dark-300 bg-dark-700/30">
        {pageNumber}
      </div>
    </div>
  )
})

// ========== 递归目录项组件 ==========
interface TocItemProps {
  item: OutlineItemType
  pdfDoc: any
  onJump: JumpCallback
  defaultExpanded?: boolean
}

const TocItemComponent: React.FC<TocItemProps> = ({ item, pdfDoc, onJump, defaultExpanded = false }) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const hasChildren = item.items && item.items.length > 0

  const handleTitleClick = async () => {
    try {
      onJump(item.page)
    } catch (error) {
      console.error('Failed to jump to page:', error)
    }
  }

  const toggleExpand = () => {
    setIsExpanded(!isExpanded)
  }

  return (
    <li style={{ listStyleType: 'none', margin: '2px 0', padding: 0 }}>
      <div 
        className="flex items-center group"
        style={{ paddingLeft: `${item.level * 16}px` }}
      >
        {hasChildren ? (
          <button
            onClick={toggleExpand}
            className="p-0.5 hover:bg-dark-600 rounded transition-colors mr-1"
          >
            <ChevronRight
              className={`w-3 h-3 text-dark-400 transition-transform duration-200 ${
                isExpanded ? 'rotate-90' : ''
              }`}
            />
          </button>
        ) : (
          <span className="w-4 h-4 flex-shrink-0" />
        )}

        <button
          onClick={handleTitleClick}
          className="flex-1 flex items-center gap-2 px-2 py-1.5 text-left text-xs text-dark-200 hover:bg-dark-700/50 rounded transition-colors"
        >
          <BookOpen className="w-3.5 h-3.5 text-primary-400 flex-shrink-0" />
          <span className="truncate flex-1 text-white font-medium hover:text-accent transition-colors" title={item.title}>
            {item.title}
          </span>
          <span className="text-white font-medium text-xs flex-shrink-0 ml-2">{item.page}</span>
        </button>
      </div>

      {hasChildren && isExpanded && (
        <ul style={{ margin: 0, padding: 0 }}>
          {item.items!.map((childItem) => (
            <TocItemComponent
              key={childItem.id}
              item={childItem}
              pdfDoc={pdfDoc}
              onJump={onJump}
              defaultExpanded={defaultExpanded}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

// ========== 主面板组件 ==========
interface PDFSidePanelProps {
  activePanel: 'thumbnails' | 'bookmarks' | null
  onClose: () => void
  width?: number
}

function PDFSidePanel({ activePanel, onClose, width = 280 }: PDFSidePanelProps) {
  const activeTabId = useAppStore((state) => state.activeTabId)
  const tabs = useAppStore((state) => state.tabs)
  const activeTab = activeTabId ? tabs.find(t => t.id === activeTabId) : undefined
  const filePath = activeTab?.filePath
  
  const updateTab = useAppStore((state) => state.updateTab)
  const modelConfigs = useAppStore((state) => state.modelConfigs)
  const currentPage = activeTab?.pageNumber || 1
  const [bookmarks, setBookmarks] = useState<OutlineItemType[]>([])
  const [loading, setLoading] = useState(false)
  const [totalPages, setTotalPages] = useState(0)

  const [generatingToc, setGeneratingToc] = useState(false)
  const [tocMessage, setTocMessage] = useState<string>('')
  const [tocSource, setTocSource] = useState<'builtin' | 'opendataloader' | 'ocr' | null>(null)
  const [hasGeneratedToc, setHasGeneratedToc] = useState(false) // 标记是否已生成目录

  // 目录生成方式选择

  const [selectedOcrModel, setSelectedOcrModel] = useState<ModelConfig | null>(null)
  const [showOcrDropdown, setShowOcrDropdown] = useState(false)
  const ocrDropdownRef = useRef<HTMLDivElement>(null)

  // 缩略图滚动相关
  const scrollRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  const handleJumpToPage: JumpCallback = (pageNumber: number) => {
    if (activeTabId) {
      updateTab(activeTabId, { pageNumber })
    }
  }

  const buildTree = (items: OutlineItemType[]): OutlineItemType[] => {
    const map = new Map<string, OutlineItemType>()
    const roots: OutlineItemType[] = []
    
    items.forEach(item => {
      map.set(item.id, { ...item, items: [] })
    })
    
    items.forEach(item => {
      const node = map.get(item.id)!
      if (item.level === 0) {
        roots.push(node)
      } else {
        let parent: OutlineItemType | undefined
        const sortedParents = items
          .filter(p => p.level < item.level)
          .sort((a, b) => item.level - a.level)
        
        for (const potentialParent of sortedParents) {
          if (map.has(potentialParent.id)) {
            parent = map.get(potentialParent.id)
            break
          }
        }
        
        if (parent) {
          parent.items = parent.items || []
          parent.items.push(node)
        } else {
          roots.push(node)
        }
      }
    })
    
    return roots
  }

  // 初始化 OCR 模型选择
  useEffect(() => {
    if (modelConfigs.length > 0) {
      const defaultCfg = modelConfigs.find((c: ModelConfig) => c.isDefault) || modelConfigs[0]
      setSelectedOcrModel(prev => {
        if (prev && modelConfigs.find((c: ModelConfig) => c.id === prev.id)) return prev
        return defaultCfg
      })
    } else {
      setSelectedOcrModel(null)
    }
  }, [modelConfigs])

  // 处理点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ocrDropdownRef.current && !ocrDropdownRef.current.contains(e.target as Node)) {
        setShowOcrDropdown(false)
      }
    }
    if (showOcrDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showOcrDropdown])

  // 加载 PDF 总页数（用于缩略图）
  useEffect(() => {
    if (activePanel !== 'thumbnails' || !filePath) return
    let cancelled = false

    const loadPdfInfo = async () => {
      try {
        let data: ArrayBuffer | Uint8Array
        if (window.api?.readFileBuffer) {
          data = await window.api.readFileBuffer(filePath)
        } else {
          const resp = await fetch(`file://${filePath}`)
          data = await resp.arrayBuffer()
        }
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data), useSystemFonts: true })
        const pdf = await loadingTask.promise
        if (!cancelled) {
          setTotalPages(pdf.numPages)
        }
        try { pdf.destroy() } catch {}
      } catch (err) {
        console.error('加载 PDF 信息失败:', err)
      }
    }

    loadPdfInfo()
    return () => { cancelled = true }
  }, [activePanel, filePath])

  // 当文件变化时，重置生成目录标记
  useEffect(() => {
    setHasGeneratedToc(false)
  }, [filePath])

  // 当 currentPage 变化时，滚动缩略图到对应位置
  useEffect(() => {
    if (activePanel !== 'thumbnails') return
    
    const container = scrollRef.current
    const el = itemRefs.current.get(currentPage)
    
    if (!container || !el) return
    
    const containerRect = container.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    
    // 检查元素是否已经在可视区域内
    const isVisible = 
      elRect.top >= containerRect.top && 
      elRect.bottom <= containerRect.bottom
    
    if (!isVisible) {
      const offset = elRect.top - containerRect.top
      container.scrollTo({
        top: container.scrollTop + offset - container.clientHeight / 2,
        behavior: 'smooth',
      })
    }
  }, [currentPage, activePanel])

  // 加载书签
  useEffect(() => {
    if (activePanel !== 'bookmarks' || !filePath) return
    // 如果已经生成了目录，不要覆盖
    if (hasGeneratedToc && bookmarks.length > 0) return
    
    let cancelled = false

    const loadBookmarks = async () => {
      setLoading(true)
      setTocSource(null)
      setBookmarks([])
      try {
        // 1. 首先尝试加载保存的目录
        if (window.api?.toc?.load) {
          const savedToc = await window.api.toc.load(filePath)
          if (savedToc.success && savedToc.toc && savedToc.toc.length > 0 && !cancelled) {
          const items: OutlineItemType[] = savedToc.toc.map((item, idx) => ({
            id: `saved-${idx}`,
            title: item.title,
            page: item.pageNumber,
            level: item.level
          }))
          setBookmarks(buildTree(items))
            setTocSource(savedToc.source as any || 'saved')
            setTocMessage(`已加载保存的目录（${savedToc.toc.length} 个章节）`)
            setTimeout(() => setTocMessage(''), 3000)
            setLoading(false)
            return
          }
        }

        // 2. 如果没有保存的目录，尝试读取 PDF 内置书签
        let data: ArrayBuffer | Uint8Array
        if (window.api?.readFileBuffer) {
          data = await window.api.readFileBuffer(filePath)
        } else {
          const resp = await fetch(`file://${filePath}`)
          data = await resp.arrayBuffer()
        }
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data), useSystemFonts: true })
        const pdf = await loadingTask.promise

        const outline = await pdf.getOutline()
        if (outline && outline.length > 0 && !cancelled) {
          const result: OutlineItemType[] = []
          const processItems = async (items: any[], level: number) => {
            for (const item of items) {
              let pageNum = 1
              try {
                const dest = item.dest
                if (dest) {
                  let destArray: any[]
                  if (typeof dest === 'string') {
                    destArray = (await pdf.getDestination(dest)) || []
                  } else {
                    destArray = dest
                  }
                  if (destArray && destArray.length > 0) {
                    const pageRef = destArray[0]
                    const pageIndex = await pdf.getPageIndex(pageRef)
                    pageNum = pageIndex + 1
                  }
                }
              } catch {}
              result.push({ id: `bm-${result.length}`, title: item.title, page: pageNum, level })
              if (item.items && item.items.length > 0) {
                await processItems(item.items, level + 1)
              }
            }
          }
          await processItems(outline, 0)
          setBookmarks(buildTree(result))
          setTocSource('builtin')
        } else if (!cancelled) {
          setBookmarks([])
        }

        try { pdf.destroy() } catch {}
      } catch (err) {
        console.error('加载书签失败:', err)
        if (!cancelled) setBookmarks([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadBookmarks()
    return () => { cancelled = true }
  }, [activePanel, filePath])

  const handleGenerateToc = async () => {
    if (!filePath) return
    setGeneratingToc(true)
    setShowOcrDropdown(false)
    setTocMessage('正在分析文档结构...')

    try {
      let data: ArrayBuffer | Uint8Array
      if (window.api?.readFileBuffer) {
        data = await window.api.readFileBuffer(filePath)
      } else {
        const resp = await fetch(`file://${filePath}`)
        data = await resp.arrayBuffer()
      }
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data), useSystemFonts: true })
      const pdf = await loadingTask.promise

      setTocMessage('正在识别章节结构...')

      // 使用 OCR + AI 识别目录
      let result
      if (selectedOcrModel) {
        setTocMessage('正在使用 OCR + AI 识别目录...')
        result = await generateTOCViaOCR(pdf, filePath, {
          provider: selectedOcrModel.provider,
          baseUrl: selectedOcrModel.baseUrl,
          apiKey: selectedOcrModel.apiKey,
          model: selectedOcrModel.model,
        })
      } else {
        result = {
          success: false,
          toc: [],
          mode: 'none',
          message: '请先选择 AI 模型'
        }
      }

      if (result.success && result.toc.length > 0) {
        const flatItems: OutlineItemType[] = result.toc.map((item, idx) => ({
          id: `gen-${idx}`,
          title: item.title,
          page: item.pageNumber,
          level: item.level
        }))
        const treeItems = buildTree(flatItems)
        setBookmarks(treeItems)
        setHasGeneratedToc(true) // 标记已生成目录

        setTocSource('ocr')
        setTocMessage(`已生成 ${result.toc.length} 个章节（OCR + ${selectedOcrModel?.model || 'AI'}）`)
        setTimeout(() => setTocMessage(''), 3000)
      } else {
        setTocMessage(result.message || '无法生成目录')
      }

      try { pdf.destroy() } catch {}
    } catch (err: any) {
      console.error('生成目录失败:', err)
      setTocMessage('生成目录时出错')
    } finally {
      setGeneratingToc(false)
    }
  }

  // 保存目录到数据库
  const handleSaveToc = async () => {
    if (!filePath || bookmarks.length === 0) return
    
    if (!window.api?.toc?.save) {
      setTocMessage('保存功能不可用，请重启应用')
      return
    }
    
    try {
      // 将树形结构扁平化
      const flattenBookmarks = (items: OutlineItemType[]): Array<{ title: string; pageNumber: number; level: number }> => {
        const result: Array<{ title: string; pageNumber: number; level: number }> = []
        const traverse = (items: OutlineItemType[], level: number) => {
          for (const item of items) {
            result.push({ title: item.title, pageNumber: item.page, level })
            if (item.items && item.items.length > 0) {
              traverse(item.items, level + 1)
            }
          }
        }
        traverse(items, 0)
        return result
      }
      
      const flatToc = flattenBookmarks(bookmarks)
      const result = await window.api.toc.save({
        filePath,
        toc: flatToc,
        source: tocSource || 'generated'
      })
      
      if (result.success) {
        setTocMessage('目录已保存')
        setTimeout(() => setTocMessage(''), 2000)
      } else {
        setTocMessage('保存失败: ' + result.message)
      }
    } catch (err: any) {
      console.error('保存目录失败:', err)
      setTocMessage('保存目录失败')
    }
  }

  const countItems = (items: OutlineItemType[]): number => {
    return items.reduce((count, item) => {
      return count + 1 + (item.items ? countItems(item.items) : 0)
    }, 0)
  }

  // ========== 缩略图面板 ==========
  if (activePanel === 'thumbnails') {
    return (
      <div className="flex flex-col h-full relative shrink-0 bg-dark-800" style={{ width: `${width}px` }}>
        {/* 头部 */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-dark-500 shrink-0">
          <span className="text-xs font-medium text-dark-200">缩略图</span>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-dark-700 text-dark-400 hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        
        {/* 缩略图列表 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-2">
          <div className="grid grid-cols-1 gap-2">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
              <ThumbnailItem
                key={pageNum}
                ref={(el) => {
                  if (el) {
                    itemRefs.current.set(pageNum, el)
                  } else {
                    itemRefs.current.delete(pageNum)
                  }
                }}
                pageNumber={pageNum}
                filePath={filePath!}
                onClick={handleJumpToPage}
                isActive={pageNum === currentPage}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ========== 目录面板 ==========
  if (activePanel === 'bookmarks') {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center h-32 text-dark-400 text-xs gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>加载中...</span>
        </div>
      )
    }

    return (
      <div className="flex flex-col h-full relative shrink-0" style={{ width: `${width}px` }}>
        <div className="flex-1 overflow-y-auto p-2">
          {/* 空状态顶部工具栏 */}
          {bookmarks.length === 0 && !generatingToc && (
            <div className="absolute top-2 right-2 z-50 flex items-center gap-1">
              <button
                onClick={onClose}
                className="p-1 rounded hover:bg-dark-700/50 transition-colors text-dark-200 hover:text-white"
                title="关闭面板"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          
          {bookmarks.length === 0 && !generatingToc ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-dark-600/50 flex items-center justify-center mb-3">
                <BookOpen className="w-6 h-6 text-dark-100" />
              </div>
              <div className="text-dark-100 text-xs mb-4 font-medium">
                此文档没有内置目录
              </div>
              
              {/* OCR 模型选择 */}
              <div className="mb-3">
                <div className="mb-3">
                  <div className="relative" ref={ocrDropdownRef}>
                    <button
                      onClick={() => modelConfigs.length > 0 && setShowOcrDropdown(!showOcrDropdown)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-dark-600/50 hover:bg-dark-600 rounded text-[10px] text-dark-200 border border-dark-500 transition-colors w-full"
                    >
                      <Bot className="w-3 h-3 text-purple-400" />
                      <span className="flex-1 text-left truncate">
                        {selectedOcrModel ? (selectedOcrModel.name || selectedOcrModel.model) : '选择 AI 模型'}
                      </span>
                      {modelConfigs.length > 0 && (
                        <ChevronRight className={`w-3 h-3 transition-transform ${showOcrDropdown ? 'rotate-90' : ''}`} />
                      )}
                    </button>

                    {showOcrDropdown && modelConfigs.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-dark-700 border border-dark-500 rounded-lg shadow-xl z-50 py-1">
                        <div className="px-3 py-1.5 text-[10px] text-dark-400 uppercase">选择 OCR 模型</div>
                        {modelConfigs.map(cfg => (
                          <button
                            key={cfg.id}
                            onClick={() => {
                              setSelectedOcrModel(cfg)
                              setShowOcrDropdown(false)
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-dark-200 hover:bg-dark-600 transition-colors"
                          >
                            <Bot className="w-4 h-4 text-purple-400" />
                            <span className="flex-1 text-left truncate">{cfg.name || cfg.model}</span>
                            {selectedOcrModel?.id === cfg.id && <Check className="w-3 h-3 text-accent" />}
                          </button>
                        ))}
                        <div className="border-t border-dark-600 mt-1 pt-1">
                          <button
                            onClick={() => {
                              setShowOcrDropdown(false)
                              window.dispatchEvent(new CustomEvent('open-settings'))
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-[10px] text-accent hover:bg-dark-600 transition-colors"
                          >
                            <Settings className="w-3 h-3" />
                            <span>打开设置配置 AI</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  {modelConfigs.length === 0 && (
                    <div className="mt-1 text-[10px] text-red-400">
                      请先配置 AI 模型
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={() => handleGenerateToc()}
                disabled={!selectedOcrModel}
                className="flex items-center gap-2 px-4 py-2 bg-accent/25 hover:bg-accent/35 disabled:opacity-50 disabled:cursor-not-allowed text-accent rounded-lg text-xs font-bold transition-all hover:scale-105 border border-accent/40 shadow-sm"
              >
                <Wand2 className="w-4 h-4" />
                <span>生成目录</span>
              </button>

              <div className="mt-3 text-[10px] text-dark-200">
                使用视觉模型智能生成目录
              </div>
            </div>
          ) : bookmarks.length === 0 && generatingToc ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Loader2 className="w-8 h-8 text-accent animate-spin mb-3" />
              <div className="text-accent text-xs font-medium mb-1">正在生成目录</div>
              <div className="text-dark-500 text-[10px]">{tocMessage}</div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-2 py-2 mb-2 border-b border-dark-600 sticky top-0 bg-dark-800 z-10">
                <div className="flex items-center gap-1.5 text-[10px] text-dark-400">
                  {tocSource === 'ocr' ? (
                    <>
                      <ScanEye className="w-3 h-3 text-purple-400" />
                      <span className="text-purple-400">由大模型智能生成</span>
                    </>
                  ) : tocSource === 'saved' ? (
                    <>
                      <Save className="w-3 h-3 text-green-400" />
                      <span className="text-green-400">已保存目录</span>
                    </>
                  ) : tocSource === 'builtin' ? (
                    <>
                      <BookOpen className="w-3 h-3 text-primary-400" />
                      <span>内置目录</span>
                    </>
                  ) : null}
                  <span className="text-dark-600">·</span>
                  <span>{countItems(bookmarks)} 项</span>
                </div>
                
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleSaveToc}
                    className="p-1 hover:bg-dark-700/50 rounded transition-colors text-dark-400 hover:text-green-400"
                    title="保存目录"
                  >
                    <Save className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => {
                      setHasGeneratedToc(false)
                      setBookmarks([])
                      setSelectedOcrModel(null)
                      setTocSource(null)
                      setTocMessage('')
                    }}
                    className="p-1 hover:bg-dark-700/50 rounded transition-colors text-dark-400 hover:text-accent"
                    title="重新生成目录"
                  >
                    {generatingToc ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <button
                    onClick={onClose}
                    className="p-1 hover:bg-dark-700/50 rounded transition-colors text-dark-400 hover:text-red-400"
                    title="关闭面板"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              
              {tocMessage && (
                <div className={`mx-2 mb-2 px-3 py-2 rounded-lg text-xs text-center ${
                  tocMessage.includes('成功') 
                    ? 'bg-green-500/10 text-green-400' 
                    : tocMessage.includes('失败') || tocMessage.includes('错误')
                      ? 'bg-red-500/10 text-red-400'
                      : 'bg-dark-700/50 text-dark-300'
                }`}>
                  {tocMessage}
                </div>
              )}
              
              <ul style={{ padding: 0, margin: 0, listStyleType: 'none' }}>
                {bookmarks.map((item) => (
                  <TocItemComponent
                    key={item.id}
                    item={item}
                    pdfDoc={null}
                    onJump={handleJumpToPage}
                    defaultExpanded={true}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    )
  }

  return null
}

export default PDFSidePanel
