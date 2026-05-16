import { convert } from '@opendataloader/pdf'
import * as fs from 'fs'
import * as path from 'path'

/**
 * 布局元素类型
 */
export type LayoutElementType = 
  | 'heading'      // 标题
  | 'paragraph'    // 正文段落
  | 'table'        // 表格
  | 'image'        // 图片
  | 'header'       // 页眉（将被过滤）
  | 'footer'       // 页脚（将被过滤）
  | 'page_number'  // 页码（将被过滤）
  | 'caption'      // 图片/表格标题
  | 'list'         // 列表

/**
 * 布局元素
 */
export interface LayoutElement {
  id: number
  type: LayoutElementType
  page: number
  bbox: [number, number, number, number]  // [x1, y1, x2, y2]
  text?: string
  orderId: number  // 全局阅读顺序
  headingLevel?: number  // 标题层级
}

/**
 * 版面分析结果
 */
export interface LayoutAnalysisResult {
  pageCount: number
  elements: LayoutElement[]
  isScanned: boolean
  textDensity: number
}

/**
 * 扫描件检测配置
 */
const SCAN_DETECTION = {
  // 文字密度阈值，低于此值认为是扫描件
  TEXT_DENSITY_THRESHOLD: 50,
  // 最小文字长度阈值
  MIN_TEXT_LENGTH: 100,
}

/**
 * 过滤配置 - 需要过滤的元素类型
 */
const FILTER_TYPES: LayoutElementType[] = ['header', 'footer', 'page_number']

/**
 * 检测是否为扫描 PDF
 * @param elements 布局元素列表
 * @param pageCount 页数
 */
function detectScannedPDF(elements: LayoutElement[], pageCount: number): { isScanned: boolean; textDensity: number } {
  // 计算总文字长度
  const totalTextLength = elements
    .filter(e => e.type === 'paragraph' || e.type === 'heading')
    .reduce((sum, e) => sum + (e.text?.length || 0), 0)
  
  // 计算文字密度（每页平均文字长度）
  const textDensity = pageCount > 0 ? totalTextLength / pageCount : 0
  
  // 判断是否为扫描件
  const isScanned = textDensity < SCAN_DETECTION.TEXT_DENSITY_THRESHOLD
  
  return { isScanned, textDensity }
}

/**
 * 过滤页眉页脚页码
 * @param elements 原始元素列表
 */
function filterHeaderFooter(elements: LayoutElement[]): LayoutElement[] {
  return elements.filter(e => !FILTER_TYPES.includes(e.type))
}

/**
 * 分析 PDF 版面布局
 * @param filePath PDF 文件路径
 * @returns 版面分析结果
 */
export async function analyzeLayout(filePath: string): Promise<LayoutAnalysisResult> {
  console.log(`[LayoutService] 开始版面分析: ${path.basename(filePath)}`)
  
  try {
    // 使用 Fast 模式获取 JSON 输出（仅布局信息）
    await convert([filePath], {
      format: 'json',
      outputDir: 'temp-layout',
      quiet: true
    })
    
    // 读取生成的 JSON 文件
    const jsonFileName = path.basename(filePath, '.pdf') + '.json'
    const jsonPath = path.join('temp-layout', jsonFileName)
    
    if (!fs.existsSync(jsonPath)) {
      throw new Error('Layout analysis failed: JSON output not found')
    }
    
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
    
    // 解析元素
    const elements: LayoutElement[] = []
    let orderId = 0
    
    if (data.kids && Array.isArray(data.kids)) {
      for (const kid of data.kids) {
        const element: LayoutElement = {
          id: kid.id || orderId,
          type: kid.type as LayoutElementType,
          page: kid['page number'] || 1,
          bbox: kid['bounding box'] || [0, 0, 0, 0],
          text: kid.content,
          orderId: orderId++,
        }
        
        // 提取标题层级
        if (kid['heading level']) {
          element.headingLevel = kid['heading level']
        }
        
        elements.push(element)
      }
    }
    
    // 获取页数
    const pageCount = data.kids?.length > 0 
      ? Math.max(...data.kids.map((k: any) => k['page number'] || 1))
      : 0
    
    // 检测是否为扫描件
    const { isScanned, textDensity } = detectScannedPDF(elements, pageCount)
    
    // 过滤页眉页脚
    const filteredElements = filterHeaderFooter(elements)
    
    console.log(`[LayoutService] 分析完成:`)
    console.log(`  - 页数: ${pageCount}`)
    console.log(`  - 总元素: ${elements.length}`)
    console.log(`  - 过滤后: ${filteredElements.length}`)
    console.log(`  - 文字密度: ${textDensity.toFixed(2)}`)
    console.log(`  - 是否扫描件: ${isScanned ? '是' : '否'}`)
    
    // 清理临时文件
    fs.rmSync('temp-layout', { recursive: true, force: true })
    
    return {
      pageCount,
      elements: filteredElements,
      isScanned,
      textDensity,
    }
    
  } catch (error) {
    console.error('[LayoutService] 版面分析失败:', error)
    throw error
  }
}

/**
 * 提取特定类型的元素
 * @param elements 元素列表
 * @param types 要提取的类型
 */
export function extractElementsByType(
  elements: LayoutElement[], 
  types: LayoutElementType[]
): LayoutElement[] {
  return elements.filter(e => types.includes(e.type))
}

/**
 * 获取页面图片元素（用于后续 OCR）
 * @param elements 元素列表
 * @param page 页码（可选，不指定则返回所有）
 */
export function getImageElements(
  elements: LayoutElement[], 
  page?: number
): LayoutElement[] {
  return elements.filter(e => {
    const isImage = e.type === 'image' || e.type === 'table'
    return page ? isImage && e.page === page : isImage
  })
}

/**
 * 获取正文元素
 * @param elements 元素列表
 */
export function getTextElements(elements: LayoutElement[]): LayoutElement[] {
  return elements.filter(e => 
    e.type === 'paragraph' || 
    e.type === 'heading' || 
    e.type === 'caption' ||
    e.type === 'list'
  )
}
