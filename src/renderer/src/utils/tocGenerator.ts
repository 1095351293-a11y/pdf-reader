export type TocItem = { title: string; pageNumber: number; level: number }

export type TocResult = {
  success: boolean
  toc: TocItem[]
  message?: string
  mode: 'outline' | 'structured' | 'none'
  quality?: {
    totalCandidates: number
    finalItems: number
    isScanned: boolean
  }
}

// ========== 从 PDF 内置书签提取目录 ==========
export async function extractOutlineFromPdf(pdf: any): Promise<TocItem[]> {
  const outline = await pdf.getOutline()
  if (!outline || outline.length === 0) return []

  const result: TocItem[] = []
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
      result.push({ title: item.title || 'Untitled', pageNumber: pageNum, level })
      if (item.items && item.items.length > 0) {
        await processItems(item.items, level + 1)
      }
    }
  }
  await processItems(outline, 0)
  return result
}

// ========== 智能页面采样策略 ==========
function getSamplePages(totalPages: number, maxSamples: number = 15): number[] {
  if (totalPages <= maxSamples) {
    // 如果页数不多，全部采样
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  const pages: number[] = []
  
  // 1. 开头部分：前3页（封面、目录、前言）
  pages.push(1, 2, 3)
  
  // 2. 中间部分：均匀采样
  const remainingSlots = maxSamples - 6  // 预留开头3页 + 结尾3页
  const step = Math.floor((totalPages - 6) / remainingSlots)
  
  for (let i = 0; i < remainingSlots; i++) {
    const page = 4 + i * step
    if (page < totalPages - 2) {
      pages.push(page)
    }
  }
  
  // 3. 结尾部分：最后3页（结论、参考文献等）
  pages.push(totalPages - 2, totalPages - 1, totalPages)
  
  // 去重并排序
  return [...new Set(pages)].sort((a, b) => a - b)
}

// ========== OCR 智能生成目录（全文采样版） ==========
export async function generateTOCViaOCR(
  pdf: any,
  filePath: string,
  aiConfig: { provider: string; baseUrl: string; apiKey: string; model: string }
): Promise<TocResult> {
  try {
    console.log('[TOC OCR] 使用 OCR + AI 分析全文生成目录...')
    console.log(`[TOC OCR] PDF 总页数: ${pdf.numPages}`)

    // 1. 智能采样页面
    const pagesToConvert = getSamplePages(pdf.numPages, 15)
    console.log(`[TOC OCR] 采样页面: ${pagesToConvert.join(',')} (共 ${pagesToConvert.length} 页)`)

    // 2. 调用 PDF 工具将采样页面转为图片
    const convertResult = await window.api.pdf.toImages({
      filePath,
      pages: pagesToConvert,
    })

    if (!convertResult.success || !convertResult.images || convertResult.images.length === 0) {
      return {
        success: false,
        toc: [],
        mode: 'none',
        message: `PDF 转图片失败: ${convertResult.message || '未知错误'}`
      }
    }

    const pageImages = convertResult.images
    console.log(`[TOC OCR] 成功转换 ${pageImages.length} 页`)

    // 3. 调用 AI 视觉模型分析全文结构
    const baseUrl = aiConfig.baseUrl.replace(/\/+$/, '')
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [
          {
            role: 'system',
            content: `你是一个专业的 PDF 文档结构分析助手。我会提供 PDF 的多个采样页面图片（包括开头、中间和结尾），请你：

1. 分析文档的整体章节结构
2. 识别所有主要章节标题和子章节标题
3. 根据页面采样位置，估算每个章节的实际页码
4. 以 JSON 数组格式返回完整目录

每个目录项包含：
- title: 章节标题
- pageNumber: 估算的页码（根据采样页面位置推算）
- level: 层级（0=一级标题，1=二级标题，2=三级标题）

注意：
- 即使文档没有内置目录，也要根据正文中的章节标题生成目录
- 章节标题通常是大写、加粗、编号（如"1. INTRODUCTION"）或特殊格式
- 根据采样页面的分布，合理推算各章节的页码位置
- 只返回 JSON 数组，不要包含其他文字

示例输出格式：
[
  {"title": "INTRODUCTION", "pageNumber": 1, "level": 0},
  {"title": "1. Background", "pageNumber": 3, "level": 1},
  {"title": "2. Methods", "pageNumber": 8, "level": 0},
  {"title": "2.1 Experimental Setup", "pageNumber": 9, "level": 1},
  {"title": "3. Results", "pageNumber": 15, "level": 0},
  {"title": "4. Discussion", "pageNumber": 22, "level": 0},
  {"title": "5. Conclusion", "pageNumber": 28, "level": 0},
  {"title": "References", "pageNumber": 30, "level": 0}
]`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `这是一份 ${pdf.numPages} 页的 PDF 文档。我提供了 ${pageImages.length} 个采样页面（包括开头、中间和结尾）。请分析这些页面，识别文档的完整章节结构，并生成目录。注意根据采样页面的位置合理推算各章节的实际页码。`
              },
              ...pageImages.map(img => ({
                type: 'image_url',
                image_url: {
                  url: img.base64
                }
              }))
            ]
          }
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    })

    if (!response.ok) {
      throw new Error(`AI API 请求失败: ${response.status}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''

    console.log('[TOC OCR] AI 返回内容:', content.substring(0, 500))

    // 4. 从返回内容中提取 JSON
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      console.warn('[TOC OCR] 无法从 AI 返回中提取 JSON:', content)
      return {
        success: false,
        toc: [],
        mode: 'none',
        message: 'AI 返回格式无法解析'
      }
    }

    const tocItems = JSON.parse(jsonMatch[0]) as TocItem[]

    // 5. 验证和清理数据
    const validItems = tocItems.filter(
      (item) => item.title && typeof item.pageNumber === 'number' && typeof item.level === 'number'
    )

    // 确保页码在合理范围内
    const cleanedItems = validItems.map(item => ({
      ...item,
      pageNumber: Math.max(1, Math.min(item.pageNumber, pdf.numPages))
    }))

    if (cleanedItems.length === 0) {
      return {
        success: false,
        toc: [],
        mode: 'none',
        message: 'AI 未识别到有效目录'
      }
    }

    console.log(`[TOC OCR] AI 识别到 ${cleanedItems.length} 个目录项`)

    return {
      success: true,
      toc: cleanedItems,
      mode: 'structured',
      quality: {
        totalCandidates: tocItems.length,
        finalItems: cleanedItems.length,
        isScanned: true,
      },
    }
  } catch (err: any) {
    console.error('[TOC OCR] 生成失败:', err)
    return {
      success: false,
      toc: [],
      mode: 'none',
      message: err.message || 'OCR 生成目录时出错'
    }
  }
}

// ========== 主入口：智能生成目录 ==========
export async function generateTOC(pdf: any, filePath: string): Promise<TocResult> {
  // 1. 首先尝试提取 PDF 内置书签
  try {
    const outline = await extractOutlineFromPdf(pdf)
    if (outline.length > 0) {
      console.log(`[TOC] 从 PDF 内置书签提取到 ${outline.length} 个目录项`)
      return {
        success: true,
        toc: outline,
        mode: 'outline',
        quality: {
          totalCandidates: outline.length,
          finalItems: outline.length,
          isScanned: false,
        },
      }
    }
  } catch (err) {
    console.warn('[TOC] 提取 PDF 内置书签失败:', err)
  }

  // 2. 如果没有内置书签，返回空结果（需要 OCR 模式）
  return {
    success: false,
    toc: [],
    mode: 'none',
    message: 'PDF 没有内置目录，请使用 OCR 模式生成目录'
  }
}
