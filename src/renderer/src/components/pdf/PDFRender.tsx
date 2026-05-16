import { useEffect, useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { workerCode } from 'virtual:pdf-worker-src'
import 'pdfjs-dist/web/pdf_viewer.css'
import type { Annotation } from '../../stores/appStore'
import { useAppStore } from '../../stores/appStore'

// ========== 提取 PDF 全文（异步，存入 store） ==========
async function extractFullText(doc: pdfjsLib.PDFDocumentProxy) {
  try {
    const parts: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      try {
        const page = await doc.getPage(i)
        const textContent = await page.getTextContent()
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join('')
        if (pageText.trim()) {
          parts.push(`--- 第 ${i} 页 ---\n${pageText}`)
        }
      } catch {
        // 跳过无法提取的页面
      }
    }
    useAppStore.getState().setPdfFullText(parts.join('\n\n'))
  } catch {
    // 全文提取失败不影响正常阅读
  }
}

// ========== 右键菜单选区信息类型 ==========
export interface ContextMenuSelection {
  text: string
  pageIndex: number
  rects: { x: number; y: number; width: number; height: number }[]
}

// ========== PDF.js Worker 单例 ==========
let workerInstance: Worker | null = null
function getPdfWorker(): Worker {
  if (workerInstance) return workerInstance
  const blob = new Blob([workerCode], { type: 'application/javascript' })
  const blobUrl = URL.createObjectURL(blob)
  workerInstance = new Worker(blobUrl)
  workerInstance.addEventListener('error', (e) => console.error('PDF Worker error:', e))
  // 延迟释放 Blob URL，确保 Worker 有时间加载
  setTimeout(() => { try { URL.revokeObjectURL(blobUrl) } catch {} }, 5000)
  return workerInstance
}
if (!pdfjsLib.GlobalWorkerOptions.workerPort) {
  pdfjsLib.GlobalWorkerOptions.workerPort = getPdfWorker()
}

interface PDFRenderProps {
  filePath: string
  pageNumber: number
  scale?: number
  highlightMode?: boolean
  annotations?: Annotation[]
  onTextSelect?: (text: string, pageIndex: number, rects: { x: number; y: number; width: number; height: number }[]) => void
  onAnnotationClick?: (annotationId: string) => void
  onRegionScreenshot?: (dataUrl: string, pageIndex: number) => void
  onPageCount?: (count: number) => void
  onPageChange?: (page: number) => void
  onScaleChange?: (scale: number) => void
  onContextMenu?: (e: React.MouseEvent, selection: ContextMenuSelection | null) => void
}

export interface PDFRenderHandle {
  /** 截取当前页整页 */
  captureScreenshot: () => Promise<string | null>
  /** 进入区域截图模式（框选） */
  startRegionScreenshot: () => void
  getCurrentPage: () => number
  getSelectedText: () => string
  /** 获取当前选区信息（文本+矩形），用于批注 */
  getSelectionInfo: () => { text: string; pageIndex: number; rects: { x: number; y: number; width: number; height: number }[] } | null
  /** 提取整个 PDF 的全文（按页拼接） */
  getFullText: () => Promise<string>
}

const PAGE_GAP = 12
const SCALE_STEPS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0]

// LRU 缓存：最多保留多少页的 bitmap（扫描件建议 20-40，纯文本可 60-120）
const BITMAP_CACHE_LIMIT = 60

// 文本层缓存：最多同时存在多少页的文本层 DOM（滚动远离后清理）
const TEXT_LAYER_LIMIT = 15

// 二分：返回第一个 > x 的索引
function upperBound(arr: number[], x: number): number {
  let l = 0, r = arr.length
  while (l < r) {
    const m = (l + r) >> 1
    if (arr[m] <= x) l = m + 1
    else r = m
  }
  return l
}

// ========== 渲染队列 + 优先级调度 ==========
interface RenderJob {
  pageIndex: number
  version: number
  priority: number // 越小越优先（0 = 当前可见页）
}

class RenderQueue {
  private queue: RenderJob[] = []
  private running = false
  private readonly concurrency: number
  private activeCount = 0
  private readonly executor: (job: RenderJob) => Promise<void>

  constructor(concurrency: number, executor: (job: RenderJob) => Promise<void>) {
    this.concurrency = concurrency
    this.executor = executor
  }

  enqueue(job: RenderJob): void {
    // 去重：同 pageIndex + version 才视为重复，version 不同或 priority 更高则替换
    const idx = this.queue.findIndex((j) => j.pageIndex === job.pageIndex && j.version === job.version)
    if (idx !== -1) {
      const old = this.queue[idx]
      const versionNewer = job.version !== old.version && job.version > old.version
      const priorityHigher = job.priority < old.priority
      if (versionNewer || priorityHigher) {
        this.queue[idx] = job
      }
    } else {
      this.queue.push(job)
    }
    // 按优先级排序
    this.queue.sort((a, b) => a.priority - b.priority)
    this.run()
  }

  removePageIndex(pageIndex: number): void {
    this.queue = this.queue.filter((j) => j.pageIndex !== pageIndex)
  }

  clear(): void {
    this.queue = []
  }

  private run(): void {
    if (this.running) return
    this.running = true
    this.tick()
  }

  private tick(): void {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!
      this.activeCount++
      this.executor(job)
        .catch(() => {})
        .finally(() => {
          this.activeCount--
          if (this.queue.length > 0) {
            this.tick()
          } else if (this.activeCount === 0) {
            this.running = false
          }
        })
    }
    if (this.activeCount === 0) {
      this.running = false
    }
  }
}

// ========== 批注高亮组件（仅渲染高亮，交互由文本层处理） ==========
function AnnotationHighlight({
  annotation,
}: {
  annotation: Annotation
}) {
  return (
    <>
      {/* 高亮矩形：pointerEvents:none 让鼠标事件穿透到文本层 */}
      {annotation.rects.map((rect, ri) => (
        <div
          key={ri}
          style={{
            position: 'absolute',
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            backgroundColor: annotation.color + '55',
            borderLeft: ri === 0 ? `2px solid ${annotation.color}` : undefined,
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />
      ))}
    </>
  )
}

const PDFRenderInner = forwardRef<PDFRenderHandle, PDFRenderProps>(function PDFRender({
  filePath,
  pageNumber,
  scale = 1.0,
  highlightMode = false,
  annotations = [],
  onTextSelect,
  onAnnotationClick,
  onRegionScreenshot,
  onPageCount,
  onPageChange,
  onScaleChange,
  onContextMenu,
}, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)

  // 每页在 scale=1 的宽高
  const baseViewportsRef = useRef<{ width: number; height: number }[]>([])

  // DOM 虚拟化范围
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: -1 })

  // 最新回调 refs（避免闭包）
  const cbRef = useRef({ onPageCount, onPageChange, onScaleChange })
  cbRef.current = { onPageCount, onPageChange, onScaleChange }

  const scaleRef = useRef(scale)
  scaleRef.current = scale

  // ========== 暴露方法给父组件 ==========
  // 区域截图模式开关（独立的 boolean，避免残留）
  const [isScreenshotMode, setIsScreenshotMode] = useState(false)

  type ScreenshotDrag = {
    dragging: boolean
    startX: number
    startY: number
    endX: number
    endY: number
  }
  const [screenshotDrag, setScreenshotDrag] = useState<ScreenshotDrag | null>(null)

  // PDF 拖拽移动状态（用于放大后拖动查看）
  type PanDrag = {
    dragging: boolean
    startX: number
    startY: number
    scrollLeft: number
    scrollTop: number
  }
  const [panDrag, setPanDrag] = useState<PanDrag | null>(null)

  // 全局鼠标释放监听（确保拖拽能正确结束）
  useEffect(() => {
    if (!panDrag?.dragging) return

    const handleGlobalMouseUp = () => {
      console.log('[PDFRender] 全局鼠标释放，结束拖拽')
      setPanDrag(null)
    }

    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [panDrag?.dragging])

  // 区域截图回调 ref（避免闭包问题）
  const onRegionScreenshotRef = useRef(onRegionScreenshot)
  onRegionScreenshotRef.current = onRegionScreenshot

  // 统一退出截图模式
  const exitScreenshotMode = useCallback(() => {
    setIsScreenshotMode(false)
    setScreenshotDrag(null)
  }, [])

  // Escape 键取消区域截图（使用捕获阶段，确保优先触发）
  useEffect(() => {
    if (!isScreenshotMode) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        exitScreenshotMode()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [isScreenshotMode, exitScreenshotMode])

  // 全局 mouseup 兜底：防止鼠标在容器外抬起导致状态残留
  useEffect(() => {
    if (!isScreenshotMode) return
    const onUp = () => {
      // 只有在非拖拽状态时才退出截图模式
      if (!screenshotDrag?.dragging) {
        console.log('[PDFRender] 全局 mouseup 兜底：退出截图模式')
        exitScreenshotMode()
      }
    }
    window.addEventListener('mouseup', onUp, true)
    return () => window.removeEventListener('mouseup', onUp, true)
  }, [isScreenshotMode, exitScreenshotMode, screenshotDrag])

  useImperativeHandle(ref, () => ({
    captureScreenshot: async (): Promise<string | null> => {
      const pageIdx = currentPageRef.current - 1
      const canvas = canvasMapRef.current.get(pageIdx)
      if (!canvas) return null
      try {
        return canvas.toDataURL('image/png')
      } catch {
        return null
      }
    },
    startRegionScreenshot: () => {
      console.log('[PDFRender] 启动区域截图模式')
      setIsScreenshotMode(true)
      setScreenshotDrag(null) // 先不进入 dragging
    },
    getCurrentPage: () => currentPageRef.current,
    getSelectedText: () => {
      const selection = window.getSelection()
      return selection?.toString() || ''
    },
    getSelectionInfo: () => {
      const selection = window.getSelection()
      const text = selection?.toString().trim()
      if (!text || !selection || selection.rangeCount === 0) return null

      const pageIdx = currentPageRef.current - 1
      const divEl = textLayerDivMapRef.current.get(pageIdx)
      if (!divEl) return null

      const range = selection.getRangeAt(0)
      const divRect = divEl.getBoundingClientRect()
      const rangeRects = range.getClientRects()
      const rects: { x: number; y: number; width: number; height: number }[] = []
      for (let r = 0; r < rangeRects.length; r++) {
        const cr = rangeRects[r]
        // 跳过宽度为0的空行
        if (cr.width < 1 || cr.height < 1) continue
        rects.push({
          x: cr.left - divRect.left,
          y: cr.top - divRect.top,
          width: cr.width,
          height: cr.height,
        })
      }
      if (rects.length === 0) return null
      return { text, pageIndex: pageIdx, rects }
    },
    getFullText: async (): Promise<string> => {
      const doc = pdfDocRef.current
      if (!doc) return ''
      const parts: string[] = []
      for (let i = 1; i <= doc.numPages; i++) {
        try {
          const page = await doc.getPage(i)
          const textContent = await page.getTextContent()
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join('')
          if (pageText.trim()) {
            parts.push(`--- 第 ${i} 页 ---\n${pageText}`)
          }
        } catch {
          // 跳过无法提取的页面
        }
      }
      return parts.join('\n\n')
    },
  }))

  // 渲染版本：文件切换或 scale 变化才递增（避免滚动导致反复渲染）
  const renderVersionRef = useRef(0)

  // 可见 canvas（每页一个）
  const canvasMapRef = useRef(new Map<number, HTMLCanvasElement>())

  // 已渲染版本（按页）
  const lastRenderedVersionRef = useRef(new Map<number, number>())

  // 离屏 canvas（每页一个）：pdf.js 永远渲染到这里，避免可见 canvas 白屏
  const offscreenCanvasRef = useRef(new Map<number, HTMLCanvasElement>())

  // bitmap 缓存（LRU）：用于"瞬时占位"，避免刚进入可见区时空白
type BitmapEntry = {
  bmp: ImageBitmap
  cssWidth: number      // displayViewport.width（CSS px）
  cssHeight: number     // displayViewport.height（CSS px）
  dpr: number           // 渲染时用的 dpr（window.devicePixelRatio）
  scale: number         // currentScale
  version: number       // renderVersionRef.current
}
const pageBitmapCacheRef = useRef(new Map<number, BitmapEntry>())
const bitmapLRURef = useRef<number[]>([]) // 最近使用队列（末尾最新）

  // 缩放锚点：保持缩放前后中心不跳
  const zoomAnchorRef = useRef<{
    oldScale: number
    anchorPage: number
    anchorOffsetInPage: number
  } | null>(null)

  // 防回流：避免滚动回传 pageNumber 又触发 scrollTo 拉回
  const currentPageRef = useRef(1)
  const syncingFromScrollRef = useRef(false)
  const lastPropPageRef = useRef<number | null>(null)

  // ===== 渲染队列（优先级调度） =====
  const renderQueueRef = useRef<RenderQueue | null>(null)

  // ===== 滚动方向追踪（预判缓冲区） =====
  const lastScrollTopRef = useRef(0)
  const scrollDirectionRef = useRef<'down' | 'up' | 'none'>('none')

  // ===== 文本层 =====
  const textLayerDivMapRef = useRef(new Map<number, HTMLDivElement>())
  const textLayerBuiltRef = useRef(new Set<number>()) // 已构建文本层的页（已废弃，改用版本号 Map）
  const textLayerLRURef = useRef<number[]>([])
  // 文本层版本控制：解决竞态问题
  const textLayerBuiltVersionRef = useRef<Map<number, number>>(new Map()) // pageIndex -> renderVersion
  const textLayerBuildingVersionRef = useRef<Map<number, number>>(new Map()) // pageIndex -> 正在构建的 version

  // ========== 1) 页面布局（offsets/totalHeight） ==========
  const pageLayout = useMemo(() => {
    const vps = baseViewportsRef.current
    const offsets: number[] = new Array(vps.length)
    const heights: number[] = new Array(vps.length)
    let acc = 0
    for (let i = 0; i < vps.length; i++) {
      offsets[i] = acc
      const h = Math.ceil(vps[i].height * scale)
      heights[i] = h
      acc += h + PAGE_GAP
    }
    return { offsets, heights, totalHeight: acc, count: vps.length }
  }, [pdfDoc, scale])

  // ========== 2) 加载 PDF（并行获取 viewport） ==========
  useEffect(() => {
    let cancelled = false

    const cleanupDoc = () => {
      renderQueueRef.current?.clear()
      canvasMapRef.current.clear()
      lastRenderedVersionRef.current.clear()
      offscreenCanvasRef.current.clear()

      // bitmap 清理
      for (const bmp of pageBitmapCacheRef.current.values()) {
        try { bmp.close() } catch {}
      }
      pageBitmapCacheRef.current.clear()
      bitmapLRURef.current = []

      // 文本层清理
      textLayerInstanceMapRef.current.forEach((tl) => {
        try { tl.cancel() } catch {}
      })
      textLayerInstanceMapRef.current.clear()
      textLayerDivMapRef.current.clear()
      textLayerBuiltRef.current.clear()
      textLayerLRURef.current = []

      if (pdfDocRef.current) {
        try { pdfDocRef.current.destroy() } catch {}
        pdfDocRef.current = null
      }
    }

    const loadPdf = async () => {
      try {
        setError(null)
        setPdfDoc(null)
        setVisibleRange({ start: 0, end: -1 })
        cleanupDoc()

        let data: ArrayBuffer | Uint8Array
        if (window.api?.readFileBuffer) {
          data = await window.api.readFileBuffer(filePath)
        } else {
          const resp = await fetch(`file://${filePath}`)
          data = await resp.arrayBuffer()
        }
        if (cancelled) return

        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(data),
          useSystemFonts: true,
        })
        const pdf = await loadingTask.promise
        if (cancelled) { try { pdf.destroy() } catch {} return }

        const viewportPromises = Array.from({ length: pdf.numPages }, (_, i) =>
          pdf.getPage(i + 1).then((p) => p.getViewport({ scale: 1.0 }))
        )
        const viewports = await Promise.all(viewportPromises)
        if (cancelled) { try { pdf.destroy() } catch {} return }

        baseViewportsRef.current = viewports.map((v) => ({ width: v.width, height: v.height }))
        pdfDocRef.current = pdf
        setPdfDoc(pdf)

        renderVersionRef.current += 1
        cbRef.current.onPageCount?.(pdf.numPages)

        // 提取全文存入 store，供 AI 对话作为上下文
        extractFullText(pdf)
      } catch (err: any) {
        if (!cancelled) setError(err?.message || '无法加载 PDF')
      }
    }

    loadPdf()

    return () => {
      cancelled = true
      cleanupDoc()
    }
  }, [filePath])

  // ========== bitmap LRU 辅助 ==========
  const touchBitmapLRU = useCallback((pageIndex: number) => {
    const q = bitmapLRURef.current
    const idx = q.indexOf(pageIndex)
    if (idx !== -1) q.splice(idx, 1)
    q.push(pageIndex)
    while (q.length > BITMAP_CACHE_LIMIT) {
      const evict = q.shift()
      if (evict === undefined) break
      const entry = pageBitmapCacheRef.current.get(evict)
      if (entry) {
        try { entry.bmp.close() } catch {}
      }
      pageBitmapCacheRef.current.delete(evict)
    }
  }, [])

  // ========== 文本层 LRU 辅助 ==========
  const touchTextLayerLRU = useCallback((pageIndex: number) => {
    const q = textLayerLRURef.current
    const idx = q.indexOf(pageIndex)
    if (idx !== -1) q.splice(idx, 1)
    q.push(pageIndex)
    while (q.length > TEXT_LAYER_LIMIT) {
      const evict = q.shift()
      if (evict === undefined) break
      const div = textLayerDivMapRef.current.get(evict)
      if (div) {
        div.innerHTML = ''
        div.style.visibility = 'hidden'
        div.style.pointerEvents = 'none'
      }
      const tl = textLayerInstanceMapRef.current.get(evict)
      if (tl) {
        try { tl.cancel() } catch {}
        textLayerInstanceMapRef.current.delete(evict)
      }
      textLayerBuiltRef.current.delete(evict)
      textLayerBuiltVersionRef.current.delete(evict)
      textLayerBuildingVersionRef.current.delete(evict)
    }
  }, [])

  // ========== 3) 离屏渲染：pdf.js -> offscreen，完成后贴到 visible ==========
  const renderPage = useCallback(async (pageIndex: number, version: number) => {
    const pdf = pdfDocRef.current
    const visibleCanvas = canvasMapRef.current.get(pageIndex)
    if (!pdf || !visibleCanvas) return

    const currentScale = scaleRef.current

    // 判断是否需要渲染 canvas：版本不匹配或 bitmap 缓存不存在
    const isVersionMatch = lastRenderedVersionRef.current.get(pageIndex) === version
    const hasBitmapCache = pageBitmapCacheRef.current.has(pageIndex)
    const needCanvas = !isVersionMatch || !hasBitmapCache

    // 判断是否需要构建文本层：硬兜底 - 检查 DOM 实际是否有 span
    const div = textLayerDivMapRef.current.get(pageIndex)
    const hasSpans = !!div && div.querySelector('span') !== null
    const builtVersion = textLayerBuiltVersionRef.current.get(pageIndex)
    const needText = !hasSpans || builtVersion !== version

    // 如果两者都不需要，直接返回
    if (!needCanvas && !needText) {
      return
    }

    try {
      const page = await pdf.getPage(pageIndex + 1)

      const stillVisible = canvasMapRef.current.get(pageIndex)
      if (!stillVisible) return

      // 如果需要渲染 canvas
      if (needCanvas) {
        const dpr = window.devicePixelRatio || 1

        // 【关键】将 DPR 乘入 scale，让 PDF.js 在内部处理所有坐标变换
        const renderScale = currentScale * dpr
        const viewport = page.getViewport({ scale: renderScale })

        // 高清 viewport 的宽高就是 Canvas 的物理像素尺寸
        const pixelW = Math.ceil(viewport.width)
        const pixelH = Math.ceil(viewport.height)

        // CSS 显示尺寸 = 物理像素 / DPR
        const displayW = Math.round(pixelW / dpr)
        const displayH = Math.round(pixelH / dpr)

        // ---- offscreen canvas：每次缩放都创建新的，避免旧纹理残留 ----
        const off = document.createElement('canvas')
        off.width = pixelW
        off.height = pixelH
        const offCtx = off.getContext('2d')
        if (!offCtx) return

        // 确保初始状态干净（Identity Matrix）
        offCtx.setTransform(1, 0, 0, 1, 0, 0)
        offCtx.clearRect(0, 0, pixelW, pixelH)

        // ---- pdf.js 渲染到 offscreen（PDF.js 自行处理所有变换） ----
        const task = page.render({ canvasContext: offCtx, viewport })

        // 如果版本已过期，取消渲染以释放 Worker 资源
        if (version !== renderVersionRef.current) {
          task.cancel()
          return
        }

        await task.promise.catch(() => undefined)

        // ---- 完成后：一次性贴到可见 canvas ----
        if (version !== renderVersionRef.current) return

        const latestVisible = canvasMapRef.current.get(pageIndex)
        if (!latestVisible) return

        const vctx = latestVisible.getContext('2d')
        if (!vctx) return

        // 尺寸更新 + CSS 缩小（同一帧内完成，避免空白帧）
        if (latestVisible.width !== pixelW || latestVisible.height !== pixelH) {
          latestVisible.width = pixelW
          latestVisible.height = pixelH
          latestVisible.style.width = `${displayW}px`
          latestVisible.style.height = `${displayH}px`
        }

        // 点对点像素拷贝（无变换，无插值）
        vctx.setTransform(1, 0, 0, 1, 0, 0)
        vctx.drawImage(off, 0, 0)

        lastRenderedVersionRef.current.set(pageIndex, version)

        // ---- bitmap 缓存 ----
      try {
        const old = pageBitmapCacheRef.current.get(pageIndex)
        if (old) old.bmp.close()
        const bmp = await createImageBitmap(off)
        // 使用 displayViewport 的宽高作为 CSS 尺寸（逻辑尺寸）
        const displayViewport = page.getViewport({ scale: currentScale })
        pageBitmapCacheRef.current.set(pageIndex, {
          bmp,
          cssWidth: displayViewport.width,
          cssHeight: displayViewport.height,
          dpr,
          scale: currentScale,
          version: renderVersionRef.current,
        })
        touchBitmapLRU(pageIndex)
      } catch {}
      }

      // ---- 文本层构建（使用逻辑尺寸的 viewport） ----
      if (needText) {
        const displayViewport = page.getViewport({ scale: currentScale })
        await buildTextLayer(pageIndex, page, displayViewport)
      }
    } catch {
      // ignore cancel/errors
    }
  }, [touchBitmapLRU])

  // ========== 文本层构建 ==========
  // 使用 TextLayer 实例，方便缩放时 update 而非重建
  const textLayerInstanceMapRef = useRef(new Map<number, pdfjsLib.TextLayer>())

  const buildTextLayer = useCallback(async (pageIndex: number, page: pdfjsLib.PDFPageProxy, viewport: pdfjsLib.PageViewport) => {
    const div = textLayerDivMapRef.current.get(pageIndex)
    if (!div) {
      console.warn('[TextLayer] No div for page', pageIndex)
      return
    }

    const version = renderVersionRef.current

    // 已是当前版本且 DOM 有内容才跳过
    const builtV = textLayerBuiltVersionRef.current.get(pageIndex)
    const hasSpans = div.querySelector('span') !== null
    if (builtV === version && hasSpans) return

    // 记录正在构建的版本（用于竞态丢弃）
    textLayerBuildingVersionRef.current.set(pageIndex, version)

    // 清空旧内容并恢复显示
    div.innerHTML = ''
    div.style.visibility = 'visible'
    div.style.pointerEvents = 'auto'

    // 设置容器宽高，确保与 viewport 一致
    div.style.width = `${viewport.width}px`
    div.style.height = `${viewport.height}px`

    // 设置 --scale-factor CSS 变量（TextLayer 内部依赖此变量定位文本 span）
    div.style.setProperty('--scale-factor', String(viewport.scale))

    const textContent = await page.getTextContent()
    try {
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: div,
        viewport,
      })
      textLayerInstanceMapRef.current.set(pageIndex, textLayer)

      await textLayer.render()
    } catch (err) {
      console.error('[TextLayer] Error rendering page', pageIndex, err)
      return
    }

    // 完成后校验：如果期间版本变了/被别的任务抢先了，丢弃本次"标记"
    if (textLayerBuildingVersionRef.current.get(pageIndex) !== version) return

    // 只有 DOM 真的有 span 才算构建成功
    const ok = div.querySelector('span') !== null
    if (ok) {
      textLayerBuiltVersionRef.current.set(pageIndex, version)
      textLayerBuiltRef.current.add(pageIndex) // 保持兼容
      touchTextLayerLRU(pageIndex)
    } else {
      // 失败不标记，允许下次重建
      textLayerBuiltVersionRef.current.delete(pageIndex)
      textLayerBuiltRef.current.delete(pageIndex)
    }
  }, [touchTextLayerLRU])

  // ========== 渲染队列初始化 ==========
  useEffect(() => {
    renderQueueRef.current = new RenderQueue(2, async (job) => {
      await renderPage(job.pageIndex, job.version)
    })
    return () => {
      renderQueueRef.current?.clear()
    }
  }, [renderPage])

  // ========== 4) 计算可见范围 + 触发渲染（滚动方向预判 + 优先级队列） ==========
  const updateVisibleRangeAndRender = useCallback(() => {
    const container = containerRef.current
    const pdf = pdfDocRef.current
    const { offsets, count } = pageLayout
    if (!container || !pdf || count === 0) return

    const scrollTop = container.scrollTop
    const viewH = container.clientHeight

    // ---- 滚动方向预判 ----
    const delta = scrollTop - lastScrollTopRef.current
    if (Math.abs(delta) > 2) {
      scrollDirectionRef.current = delta > 0 ? 'down' : 'up'
    }
    lastScrollTopRef.current = scrollTop

    // 方向性缓冲区：前进方向多缓冲，后方少缓冲
    const dir = scrollDirectionRef.current
    const forwardBuffer = viewH * 2.0
    const backwardBuffer = viewH * 0.5
    const bufferBefore = dir === 'up' ? forwardBuffer : backwardBuffer
    const bufferAfter = dir === 'down' ? forwardBuffer : backwardBuffer

    const startY = Math.max(0, scrollTop - bufferBefore)
    const endY = scrollTop + viewH + bufferAfter

    let start = upperBound(offsets, startY) - 1
    if (start < 0) start = 0
    start = Math.max(0, start - 1)

    let end = start
    while (end < count) {
      if (offsets[end] > endY) break
      end++
    }
    end = Math.min(count - 1, end)

    setVisibleRange((prev) => {
      if (prev.start === start && prev.end === end) return prev
      return { start, end }
    })

    // ---- 当前页中心（用于优先级计算） ----
    const centerY = scrollTop + viewH / 2
    let centerIdx = upperBound(offsets, centerY) - 1
    if (centerIdx < 0) centerIdx = 0
    if (centerIdx >= count) centerIdx = count - 1
    while (centerIdx + 1 < count && offsets[centerIdx + 1] <= centerY) centerIdx++
    while (centerIdx > 0 && offsets[centerIdx] > centerY) centerIdx--

    // ---- 通过渲染队列按优先级调度 ----
    const queue = renderQueueRef.current
    if (queue) {
      for (let i = start; i <= end; i++) {
        if (lastRenderedVersionRef.current.get(i) === renderVersionRef.current) continue
        const priority = Math.abs(i - centerIdx)
        queue.enqueue({ pageIndex: i, version: renderVersionRef.current, priority })
      }
    }

    // 当前页跟踪
    const newPage = centerIdx + 1
    currentPageRef.current = newPage

    syncingFromScrollRef.current = true
    cbRef.current.onPageChange?.(newPage)
    requestAnimationFrame(() => { syncingFromScrollRef.current = false })

    // ---- requestIdleCallback 清理远离可见区的 offscreen canvas ----
    scheduleCleanup(start, end, count)
  }, [pageLayout, renderPage])

  // ========== requestIdleCallback 清理远离可见区的资源 ==========
  const scheduleCleanup = useCallback((visibleStart: number, visibleEnd: number, totalPages: number) => {
    const cleanup = () => {
      const safeRange = 30 // 超出此范围才清理
      for (let i = 0; i < totalPages; i++) {
        if (i >= visibleStart - safeRange && i <= visibleEnd + safeRange) continue
        // 清理 offscreen canvas（bitmap 保留用于占位，LRU 自动淘汰）
        const off = offscreenCanvasRef.current.get(i)
        if (off) {
          off.width = 0
          off.height = 0
          offscreenCanvasRef.current.delete(i)
        }
      }
    }
    if ('requestIdleCallback' in window) {
      ;(window as any).requestIdleCallback(cleanup, { timeout: 3000 })
    } else {
      setTimeout(cleanup, 1000)
    }
  }, [])

  // ========== 5) scroll 监听 ==========
  useEffect(() => {
    const container = containerRef.current
    if (!container || !pdfDoc) return

    let raf = 0
    const onScroll = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        updateVisibleRangeAndRender()
      })
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    requestAnimationFrame(() => updateVisibleRangeAndRender())

    return () => {
      if (raf) cancelAnimationFrame(raf)
      container.removeEventListener('scroll', onScroll)
    }
  }, [pdfDoc, updateVisibleRangeAndRender])

  // ========== 6) scale 变化：版本 +1 + 清除文本层 + 应用缩放锚点 + 重新渲染 ==========
  useEffect(() => {
    if (!pdfDoc) return
    renderVersionRef.current += 1
    // 缩放变化时文本层需要重建
    textLayerBuiltRef.current.clear()
    // 取消并清理旧的 TextLayer 实例
    textLayerInstanceMapRef.current.forEach((tl) => {
      try { tl.cancel() } catch {}
    })
    textLayerInstanceMapRef.current.clear()
    // 清空所有文本层 div 的内容
    textLayerDivMapRef.current.forEach((div) => {
      div.innerHTML = ''
    })

    requestAnimationFrame(() => {
      const anchor = zoomAnchorRef.current
      const container = containerRef.current
      if (anchor && container && pageLayout.count > 0) {
        const { offsets } = pageLayout
        const { oldScale, anchorPage, anchorOffsetInPage } = anchor
        const newScale = scaleRef.current
        const ratio = newScale / oldScale
        const newCenterY = (offsets[anchorPage] ?? 0) + anchorOffsetInPage * ratio
        container.scrollTop = Math.max(0, newCenterY - container.clientHeight / 2)
        zoomAnchorRef.current = null
      }
      updateVisibleRangeAndRender()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, pdfDoc])

  // ========== 7) Ctrl/⌘ + Wheel 缩放 ==========
  const onWheel = useCallback((e: WheelEvent) => {
    if (!containerRef.current || !pdfDocRef.current) return

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()

      const container = containerRef.current
      const { offsets, count } = pageLayout
      const centerY = container.scrollTop + container.clientHeight / 2
      let pageIdx = upperBound(offsets, centerY) - 1
      if (pageIdx < 0) pageIdx = 0
      if (pageIdx >= count) pageIdx = count - 1

      const offsetInPage = Math.max(0, centerY - offsets[pageIdx])
      zoomAnchorRef.current = {
        oldScale: scaleRef.current,
        anchorPage: pageIdx,
        anchorOffsetInPage: offsetInPage,
      }

      const delta = e.deltaY > 0 ? -1 : 1
      let nearest = 0
      let best = Infinity
      for (let i = 0; i < SCALE_STEPS.length; i++) {
        const d = Math.abs(SCALE_STEPS[i] - scaleRef.current)
        if (d < best) { best = d; nearest = i }
      }
      const nextIdx = Math.max(0, Math.min(SCALE_STEPS.length - 1, nearest + delta))
      cbRef.current.onScaleChange?.(SCALE_STEPS[nextIdx])
    }
  }, [pageLayout])

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel as EventListener)
  }, [onWheel])

  // ========== 8) 外部页码跳转（只在 prop 真变化时触发） ==========
  useEffect(() => {
    const container = containerRef.current
    if (!container || !pdfDoc) return

    if (lastPropPageRef.current === pageNumber) return
    lastPropPageRef.current = pageNumber

    const targetPage = Math.max(1, Math.min(pageLayout.count, pageNumber))
    if (syncingFromScrollRef.current) return

    const targetTop = pageLayout.offsets[targetPage - 1] ?? 0
    container.scrollTo({ top: targetTop, behavior: 'smooth' })
  }, [pageNumber, pdfDoc, pageLayout.count, pageLayout.offsets])

  // ========== UI ==========
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ minHeight: 0 }}>
        <div className="text-red-400">{error}</div>
      </div>
    )
  }

  if (!pdfDoc) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ minHeight: 0 }}>
        <div className="w-8 h-8 border-2 border-white/40 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const { start, end } = visibleRange
  const pages: number[] = []
  for (let i = start; i <= end; i++) pages.push(i)

  return (
    <div
      ref={(node) => { containerRef.current = node }}
      className="overflow-auto focus:outline-none"
      style={{
        position: 'absolute',
        inset: 0,
        background: '#1a1a2e',
        overscrollBehavior: 'contain',
        cursor: isScreenshotMode ? 'crosshair' : panDrag?.dragging ? 'grabbing' : scale > 1 ? 'grab' : undefined,
      }}
      tabIndex={0}
      onMouseDown={(e) => {
        console.log('[PDFRender] onMouseDown', { isScreenshotMode, button: e.button })
        const container = containerRef.current
        if (!container) return

        // 截图模式：框选
        if (isScreenshotMode) {
          if (e.button !== 0) return
          const rect = container.getBoundingClientRect()
          const px = e.clientX - rect.left + container.scrollLeft
          const py = e.clientY - rect.top + container.scrollTop
          console.log('[PDFRender] 开始截图拖拽', { px, py })
          setScreenshotDrag({ dragging: true, startX: px, startY: py, endX: px, endY: py })
          return
        }

        // 普通模式：按住鼠标拖动平移（当放大时）
        if (e.button !== 0) return
        // 如果点击的是具体文字（span），不启动拖拽（允许文字选择）
        const target = e.target as HTMLElement
        console.log('[PDFRender] onMouseDown target:', target.tagName, target.className)
        // 只有点击到具体的文字 span 时才不启动拖拽
        if (target.tagName === 'SPAN' || target.closest('span')) {
          console.log('[PDFRender] 点击的是文字，不启动拖拽')
          return
        }
        console.log('[PDFRender] 开始平移拖拽')
        // 阻止默认行为，防止文本选择
        e.preventDefault()
        // 清除当前选区
        window.getSelection()?.removeAllRanges()
        setPanDrag({
          dragging: true,
          startX: e.clientX,
          startY: e.clientY,
          scrollLeft: container.scrollLeft,
          scrollTop: container.scrollTop
        })
      }}
      onMouseMove={(e) => {
        // 截图模式
        if (isScreenshotMode && screenshotDrag?.dragging) {
          const container = containerRef.current
          if (!container) return
          const rect = container.getBoundingClientRect()
          const px = e.clientX - rect.left + container.scrollLeft
          const py = e.clientY - rect.top + container.scrollTop
          setScreenshotDrag(prev => prev ? { ...prev, endX: px, endY: py } : prev)
          return
        }

        // 平移模式
        if (panDrag?.dragging) {
          e.preventDefault()
          // 持续清除选区
          window.getSelection()?.removeAllRanges()
          const container = containerRef.current
          if (!container) return
          const dx = e.clientX - panDrag.startX
          const dy = e.clientY - panDrag.startY
          container.scrollLeft = panDrag.scrollLeft - dx
          container.scrollTop = panDrag.scrollTop - dy
        }
      }}
      onMouseUp={(e) => {
        console.log('[PDFRender] onMouseUp', { isScreenshotMode, button: e.button, screenshotDrag: screenshotDrag?.dragging, panDrag: panDrag?.dragging })

        // 处理平移拖拽结束
        if (panDrag?.dragging) {
          console.log('[PDFRender] 结束平移拖拽')
          setPanDrag(null)
          return
        }

        // 截图模式处理
        if (!isScreenshotMode) {
          console.log('[PDFRender] onMouseUp 提前返回: isScreenshotMode=false')
          return
        }
        if (e.button !== 0) {
          console.log('[PDFRender] onMouseUp 提前返回: button!==0', e.button)
          return
        }
        if (!screenshotDrag?.dragging) {
          console.log('[PDFRender] onMouseUp 提前返回: 没有在拖拽')
          return
        }

        // 先把 drag 状态取出来
        const { startX, startY, endX, endY } = screenshotDrag
        console.log('[PDFRender] onMouseUp 拖拽坐标', { startX, startY, endX, endY })
        setScreenshotDrag(null)

        const x = Math.min(startX, endX)
        const y = Math.min(startY, endY)
        const w = Math.abs(endX - startX)
        const h = Math.abs(endY - startY)
        console.log('[PDFRender] onMouseUp 框选尺寸', { x, y, w, h })

        // 框选区域太小，直接退出模式
        if (w < 10 || h < 10) {
          console.log('[PDFRender] onMouseUp 提前返回: 框选区域太小')
          exitScreenshotMode()
          return
        }

        const container = containerRef.current
        if (!container) {
          console.log('[PDFRender] onMouseUp 提前返回: container 不存在')
          exitScreenshotMode()
          return
        }

        // 找到当前页 canvas
        const pageIdx = currentPageRef.current - 1
        console.log('[PDFRender] onMouseUp 当前页', { pageIdx, currentPage: currentPageRef.current })
        const canvas = canvasMapRef.current.get(pageIdx)
        if (!canvas) {
          console.log('[PDFRender] onMouseUp 提前返回: canvas 不存在', { pageIdx, canvasMapKeys: [...canvasMapRef.current.keys()] })
          exitScreenshotMode()
          return
        }

        // canvas 的偏移量（相对于滚动容器）
        const canvasRect = canvas.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        const canvasOffsetX = canvasRect.left - containerRect.left + container.scrollLeft
        const canvasOffsetY = canvasRect.top - containerRect.top + container.scrollTop

        // 将框选坐标转为 canvas 像素坐标
        const scaleX = canvas.width / canvasRect.width
        const scaleY = canvas.height / canvasRect.height

        const sx = Math.max(0, (x - canvasOffsetX) * scaleX)
        const sy = Math.max(0, (y - canvasOffsetY) * scaleY)
        const sw = Math.min(canvas.width - sx, w * scaleX)
        const sh = Math.min(canvas.height - sy, h * scaleY)

        if (sw <= 0 || sh <= 0) { exitScreenshotMode(); return }

        try {
          console.log('[PDFRender] 开始裁剪截图', { sx, sy, sw, sh, pageIdx })
          const cropCanvas = document.createElement('canvas')
          cropCanvas.width = Math.round(sw)
          cropCanvas.height = Math.round(sh)
          const ctx = cropCanvas.getContext('2d')!
          ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, cropCanvas.width, cropCanvas.height)
          const dataUrl = cropCanvas.toDataURL('image/png')
          console.log('[PDFRender] 截图生成成功', { dataUrlLength: dataUrl?.length, pageIdx })
          console.log('[PDFRender] 调用 onRegionScreenshot 回调')
          onRegionScreenshotRef.current?.(dataUrl, pageIdx)
          console.log('[PDFRender] onRegionScreenshot 回调执行完成')
        } catch (err) {
          console.error('[PDFRender] 截图生成失败:', err)
        }
        // 成功或失败都退出截图模式
        exitScreenshotMode()
      }}
      onMouseLeave={() => {
        // 只在非拖拽状态且截图模式开启时才退出
        if (isScreenshotMode && !screenshotDrag?.dragging) {
          console.log('[PDFRender] 鼠标离开容器，退出截图模式')
          exitScreenshotMode()
        }
      }}
      onBlur={() => {
        // 只在非拖拽状态且截图模式开启时才退出
        if (isScreenshotMode && !screenshotDrag?.dragging) {
          console.log('[PDFRender] 失去焦点，退出截图模式')
          exitScreenshotMode()
        }
      }}
    >
      <div className="relative mx-auto" style={{ height: pageLayout.totalHeight, width: '100%' }}>
        {pages.map((i) => {
          const vp = baseViewportsRef.current[i]
          if (!vp) return null

          const width = Math.ceil(vp.width * scale)
          const height = Math.ceil(vp.height * scale)
          const top = pageLayout.offsets[i]

          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: 0,
                top,
                width,
                height,
                overflow: 'hidden',
              }}
            >
              <canvas
                ref={(el) => {
                  if (el) {
                    canvasMapRef.current.set(i, el)

                    // 尝试从缓存即时恢复（解决滚动回去白屏的关键）
                    const entry = pageBitmapCacheRef.current.get(i)
                    const dprNow = window.devicePixelRatio || 1
                    let restoredFromCache = false

                    // 缓存有效条件：dpr 和 scale 都匹配
                    if (entry && entry.dpr === dprNow && entry.scale === scale) {
                      const { bmp, cssWidth, cssHeight } = entry
                      const ctx = el.getContext('2d')
                      if (ctx) {
                        // backing store 用 bmp 像素尺寸
                        if (el.width !== bmp.width || el.height !== bmp.height) {
                          el.width = bmp.width
                          el.height = bmp.height
                        }
                        // CSS 尺寸用缓存记录的逻辑尺寸（不依赖 dpr_now、不 round）
                        el.style.width = `${cssWidth}px`
                        el.style.height = `${cssHeight}px`

                        ctx.setTransform(1, 0, 0, 1, 0, 0)
                        ctx.drawImage(bmp, 0, 0)
                        restoredFromCache = true
                        touchBitmapLRU(i)
                      }
                    }

                    // 决定是否需要入队渲染
                    // A: 版本不匹配（scale 变了）  B: 缓存丢失了（LRU 淘汰）
                    const isVersionMatch = lastRenderedVersionRef.current.get(i) === renderVersionRef.current
                    if (!isVersionMatch || !restoredFromCache) {
                      const queue = renderQueueRef.current
                      if (queue) {
                        const centerPage = currentPageRef.current - 1
                        const priority = Math.abs(i - centerPage)
                        queue.enqueue({ pageIndex: i, version: renderVersionRef.current, priority })
                      }
                    } else if (restoredFromCache && isVersionMatch) {
                      // 从缓存恢复且版本匹配：检查文本层是否需要重建
                      const div = textLayerDivMapRef.current.get(i)
                      const hasSpans = !!div && div.querySelector('span') !== null
                      const builtVersion = textLayerBuiltVersionRef.current.get(i)
                      if (!hasSpans || builtVersion !== renderVersionRef.current) {
                        const queue = renderQueueRef.current
                        if (queue) {
                          const centerPage = currentPageRef.current - 1
                          const priority = Math.abs(i - centerPage)
                          queue.enqueue({ pageIndex: i, version: renderVersionRef.current, priority })
                        }
                      }
                    }
                  } else {
                    renderQueueRef.current?.removePageIndex(i)
                    canvasMapRef.current.delete(i)
                    // 不删 lastRenderedVersionRef，保留版本记录供下次参考
                  }
                }}
                className="shadow-2xl bg-white"
                style={{ display: 'block', pointerEvents: 'none' }}
              />
              {/* 文本层：覆盖在 canvas 上方，支持选择/复制文字 */}
              <div
                ref={(el) => {
                  if (el) {
                    textLayerDivMapRef.current.set(i, el)
                  } else {
                    textLayerDivMapRef.current.delete(i)
                  }
                }}
                className="textLayer"
                style={{
                  pointerEvents: isScreenshotMode ? 'none' : 'auto',
                  zIndex: 10, // 提高 zIndex，确保在 AnnotationHighlight 之上
                  userSelect: isScreenshotMode ? 'none' : 'text',
                  WebkitUserSelect: isScreenshotMode ? 'none' : 'text',
                }}
                onContextMenu={(e) => {
                  if (isScreenshotMode) return
                  e.preventDefault()

                  const selection = window.getSelection()
                  const text = selection?.toString().trim()
                  const pageIdx = i

                  if (text && selection && selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0)
                    const divEl = textLayerDivMapRef.current.get(pageIdx)
                    const rects: { x: number; y: number; width: number; height: number }[] = []
                    if (divEl) {
                      const divRect = divEl.getBoundingClientRect()
                      const rangeRects = range.getClientRects()
                      for (let r = 0; r < rangeRects.length; r++) {
                        const cr = rangeRects[r]
                        if (cr.width < 1 || cr.height < 1) continue
                        rects.push({
                          x: cr.left - divRect.left,
                          y: cr.top - divRect.top,
                          width: cr.width,
                          height: cr.height,
                        })
                      }
                    }
                    onContextMenu?.(e, { text, pageIndex: pageIdx, rects })
                  } else {
                    onContextMenu?.(e, null)
                  }
                }}
                onMouseUp={(e) => {
                  const selection = window.getSelection()
                  const text = selection?.toString().trim()
                  if (text && highlightMode && onTextSelect) {
                    // 获取选区的矩形信息（相对于文本层 div）
                    const rects: { x: number; y: number; width: number; height: number }[] = []
                    if (selection && selection.rangeCount > 0) {
                      const range = selection.getRangeAt(0)
                      const divEl = textLayerDivMapRef.current.get(i)
                      if (divEl) {
                        const divRect = divEl.getBoundingClientRect()
                        const rangeRects = range.getClientRects()
                        for (let r = 0; r < rangeRects.length; r++) {
                          const cr = rangeRects[r]
                          rects.push({
                            x: cr.left - divRect.left,
                            y: cr.top - divRect.top,
                            width: cr.width,
                            height: cr.height,
                          })
                        }
                      }
                    }
                    onTextSelect(text, i, rects)
                  } else if (!text && onAnnotationClick) {
                    // 没有选中文字（单击）：检测点击位置是否在某个批注矩形内
                    const divEl = textLayerDivMapRef.current.get(i)
                    if (divEl) {
                      const divRect = divEl.getBoundingClientRect()
                      const cx = (e as React.MouseEvent).clientX - divRect.left
                      const cy = (e as React.MouseEvent).clientY - divRect.top
                      const pageAnnotations = annotations.filter((ann) => ann.pageIndex === i && ann.rects.length > 0)
                      for (const ann of pageAnnotations) {
                        for (const rect of ann.rects) {
                          if (cx >= rect.x && cx <= rect.x + rect.width && cy >= rect.y && cy <= rect.y + rect.height) {
                            onAnnotationClick(ann.id)
                            return
                          }
                        }
                      }
                    }
                  }
                }}
              />
              {/* 高亮批注渲染层 */}
              {annotations
                .filter((ann) => ann.pageIndex === i && ann.rects.length > 0)
                .map((ann) => (
                  <AnnotationHighlight
                    key={ann.id}
                    annotation={ann}
                  />
                ))}
              {/* 视觉间距（不影响绝对定位高度计算） */}
              <div style={{ height: PAGE_GAP }} />
            </div>
          )
        })}
      </div>

      {/* 区域截图提示：进入截图模式但还没开始拖拽时显示 */}
      {isScreenshotMode && !screenshotDrag?.dragging && (
        <div
          style={{
            position: 'fixed',
            top: 60,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10000,
            background: 'rgba(0, 0, 0, 0.75)',
            color: '#fff',
            padding: '8px 20px',
            borderRadius: 6,
            fontSize: 14,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          按住左键拖拽选择截图区域，按 Esc 退出截图模式
        </div>
      )}

      {/* 区域截图覆盖层：正在拖拽时显示 */}
      {screenshotDrag?.dragging && (() => {
        const { startX, startY, endX, endY } = screenshotDrag
        const left = Math.min(startX, endX)
        const top = Math.min(startY, endY)
        const width = Math.abs(endX - startX)
        const height = Math.abs(endY - startY)
        return (
          <div
            style={{
              position: 'absolute',
              left,
              top,
              width,
              height,
              border: '2px dashed #4A90D9',
              backgroundColor: 'rgba(74, 144, 217, 0.15)',
              pointerEvents: 'none',
              zIndex: 999,
            }}
          />
        )
      })()}
    </div>
  )
})

export default PDFRenderInner
