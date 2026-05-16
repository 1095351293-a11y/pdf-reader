import * as path from 'path'
import { 
  analyzeLayout, 
  LayoutAnalysisResult,
  LayoutElement,
  getImageElements,
  getTextElements 
} from './layoutService'
import { 
  recognizeImage,
  setDeepSeekConfig,
  validateConfig 
} from './pdfImageRecognitionService'
import { 
  pdfPageToImage, 
  cropImage, 
  cleanupTempFiles 
} from './pdfUtils'

// 配置接口
export interface PDFProcessorConfig {
  deepSeekApiKey?: string
  deepSeekBaseUrl?: string
  deepSeekModel?: string
  useDeepSeekOCR: boolean
  enableTableRecognition: boolean
  enableImageDescription: boolean
}

// 默认配置
const DEFAULT_CONFIG: PDFProcessorConfig = {
  useDeepSeekOCR: false,
  enableTableRecognition: true,
  enableImageDescription: false,
}

// 全局配置
let globalConfig: PDFProcessorConfig = { ...DEFAULT_CONFIG }

/**
 * 设置处理器配置
 */
export function setPDFProcessorConfig(config: Partial<PDFProcessorConfig>) {
  globalConfig = { ...globalConfig, ...config }
  
  // 同步更新 DeepSeek 配置
  const deepSeekConfig: any = {}
  if (config.deepSeekApiKey) deepSeekConfig.apiKey = config.deepSeekApiKey
  if (config.deepSeekBaseUrl) deepSeekConfig.baseUrl = config.deepSeekBaseUrl
  if (config.deepSeekModel) deepSeekConfig.model = config.deepSeekModel
  
  if (Object.keys(deepSeekConfig).length > 0) {
    setDeepSeekConfig(deepSeekConfig)
  }
}

/**
 * 获取当前配置
 */
export function getPDFProcessorConfig(): PDFProcessorConfig {
  return { ...globalConfig }
}

/**
 * 处理非扫描 PDF
 * 按 XY-Cut++ 阅读顺序处理所有元素，更新元素的 text 字段
 * 返回更新后的结构化元素数组
 */
async function processNonScannedPDF(
  filePath: string,
  layout: LayoutAnalysisResult
): Promise<LayoutElement[]> {
  console.log('[PDFProcessor] 处理非扫描 PDF，按阅读顺序处理')
  
  // 按 orderId 排序（XY-Cut++ 确定的阅读顺序）
  const sortedElements = [...layout.elements].sort((a, b) => a.orderId - b.orderId)
  
  // 创建新的元素数组（深拷贝，避免修改原始数据）
  const processedElements: LayoutElement[] = sortedElements.map(e => ({ ...e }))
  
  const imageElements = processedElements.filter(e => e.type === 'image' || e.type === 'table')
  
  // 检查是否需要 OCR
  const needOCR = globalConfig.useDeepSeekOCR && imageElements.length > 0
  let isOCRConfigValid = false
  
  if (needOCR) {
    isOCRConfigValid = await validateConfig()
    if (!isOCRConfigValid) {
      console.warn('[PDFProcessor] 视觉模型 API 未配置，跳过图片识别')
    } else {
      console.log(`[PDFProcessor] 将识别 ${imageElements.length} 个图片/表格`)
    }
  }
  
  // 临时目录（用于 OCR）
  const tempDir = 'temp-pdf-images'
  const processedPages = new Set<number>()
  
  try {
    // 按阅读顺序处理每个元素
    for (const element of processedElements) {
      // 跳过页眉页脚
      if (element.type === 'header' || element.type === 'footer' || element.type === 'page_number') {
        continue
      }
      
      // 处理图片/表格（需要 OCR）
      if ((element.type === 'image' || element.type === 'table') && needOCR && isOCRConfigValid) {
        try {
          // 只在需要时转换页面为图片
          if (!processedPages.has(element.page)) {
            await pdfPageToImage(filePath, element.page, tempDir)
            processedPages.add(element.page)
          }
          
          // 裁剪出元素区域
          const pageImagePath = path.join(tempDir, `page-${String(element.page).padStart(2, '0')}.png`)
          const croppedPath = path.join(tempDir, `element_${element.id}_page${element.page}.png`)
          await cropImage(pageImagePath, element.bbox, croppedPath)
          
          // 识别内容
          const type = element.type === 'table' ? 'table' : 'chart'
          const ocrResult = await recognizeImage(croppedPath, type)
          
          // 更新元素的 text 字段（保留结构化信息）
          element.text = ocrResult.text
          
          console.log(`[PDFProcessor] 已识别 ${element.type} (orderId: ${element.orderId})`)
        } catch (error) {
          console.error(`[PDFProcessor] 识别 ${element.type} 失败 (id: ${element.id}):`, error)
          element.text = '[识别失败]'
        }
      }
      
      // 如果不需要 OCR，给图片/表格添加占位符
      if ((element.type === 'image' || element.type === 'table') && (!needOCR || !isOCRConfigValid)) {
        element.text = element.type === 'table' ? '[表格]' : '[图片]'
      }
    }
  } finally {
    // 清理临时文件
    if (processedPages.size > 0) {
      cleanupTempFiles(tempDir)
    }
  }
  
  console.log(`[PDFProcessor] 处理完成，共处理 ${processedElements.length} 个元素`)
  return processedElements
}

/**
 * 处理扫描 PDF
 * 页面转图 → 按 bbox 切块 → 全部送 OCR
 * 返回更新后的结构化元素数组
 */
async function processScannedPDF(
  filePath: string,
  layout: LayoutAnalysisResult
): Promise<LayoutElement[]> {
  console.log('[PDFProcessor] 处理扫描 PDF')
  
  // 检查 OCR 配置
  const isConfigValid = await validateConfig()
  if (!isConfigValid) {
    console.warn('[PDFProcessor] 视觉模型 API 未配置，无法处理扫描 PDF')
    // 返回原始元素，但标记为未识别
    return layout.elements.map(e => ({
      ...e,
      text: e.type === 'image' || e.type === 'table' ? '[未识别]' : e.text
    }))
  }
  
  // 按 orderId 排序
  const sortedElements = [...layout.elements].sort((a, b) => a.orderId - b.orderId)
  
  // 创建新的元素数组
  const processedElements: LayoutElement[] = sortedElements.map(e => ({ ...e }))
  
  const tempDir = 'temp-scanned-pdf'
  const processedPages = new Set<number>()
  
  try {
    // 按页处理
    const pages = new Set(processedElements.map(e => e.page))
    
    for (const page of pages) {
      console.log(`[PDFProcessor] 处理第 ${page} 页`)
      
      // 页面转图
      if (!processedPages.has(page)) {
        await pdfPageToImage(filePath, page, tempDir)
        processedPages.add(page)
      }
      
      const pageImagePath = path.join(tempDir, `page-${String(page).padStart(2, '0')}.png`)
      
      // 获取该页的所有元素
      const pageElements = processedElements.filter(e => e.page === page)
      
      // 按阅读顺序处理每个元素
      for (const element of pageElements) {
        try {
          // 裁剪元素区域
          const elementImagePath = path.join(tempDir, `page${page}_element${element.id}.png`)
          await cropImage(pageImagePath, element.bbox, elementImagePath)
          
          // 根据类型选择识别方式
          let type: 'text' | 'table' | 'chart' = 'text'
          if (element.type === 'table') type = 'table'
          else if (element.type === 'image') type = 'chart'
          
          const ocrResult = await recognizeImage(elementImagePath, type)
          
          // 更新元素的 text 字段
          element.text = ocrResult.text
          
          console.log(`[PDFProcessor] 已识别 ${element.type} (orderId: ${element.orderId})`)
        } catch (error) {
          console.error(`[PDFProcessor] 识别元素失败 (id: ${element.id}):`, error)
          element.text = '[识别失败]'
        }
      }
    }
  } catch (error) {
    console.error('[PDFProcessor] 扫描 PDF 处理失败:', error)
  } finally {
    cleanupTempFiles(tempDir)
  }
  
  return processedElements
}

/**
 * 主处理函数
 * 返回更新后的结构化元素数组（保留所有结构化信息）
 */
export async function processPDF(
  filePath: string
): Promise<{
  elements: LayoutElement[]
  pageCount: number
  isScanned: boolean
  textDensity: number
}> {
  console.log(`[PDFProcessor] 开始处理 PDF: ${path.basename(filePath)}`)
  
  try {
    // 1. 版面分析
    const layout = await analyzeLayout(filePath)
    console.log(`[PDFProcessor] 版面分析完成: ${layout.pageCount} 页, ${layout.elements.length} 个元素`)
    
    // 2. 根据类型选择处理方式
    let processedElements: LayoutElement[]
    
    if (layout.isScanned) {
      // 扫描件：全部 OCR
      processedElements = await processScannedPDF(filePath, layout)
    } else {
      // 非扫描件：文字直接用，图片/表格 OCR
      processedElements = await processNonScannedPDF(filePath, layout)
    }
    
    console.log(`[PDFProcessor] PDF 处理完成: ${processedElements.length} 个元素`)
    
    return {
      elements: processedElements,
      pageCount: layout.pageCount,
      isScanned: layout.isScanned,
      textDensity: layout.textDensity,
    }
    
  } catch (error) {
    console.error('[PDFProcessor] PDF 处理失败:', error)
    throw error
  }
}
