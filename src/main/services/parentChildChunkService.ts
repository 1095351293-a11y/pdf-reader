/**
 * 父子双块 Chunk 服务
 * 在现有系统基础上添加父子双块结构，解决上下文缺失问题
 */

import { LayoutElement } from './layoutService'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

// ========== 类型定义 ==========

export interface ParentChildChunk {
  id: string
  pdfId: string
  content: string
  pageNumber: number
  chunkIndex: number
  elementType: string
  section?: string
  bbox?: string
  tokens: number
  // 父子关系字段
  parentId?: string
  childIds?: string
  chunkRole: 'parent' | 'child' | 'both'
  groupKey?: string
}

interface ParentGroup {
  elements: LayoutElement[]
  content: string
  tokens: number
  section: string
  pageNumber: number
  groupKey: string
  startBbox?: number[]
}

// ========== 配置 ==========

const CONFIG = {
  parentMaxTokens: 800,    // 父块最大 tokens
  childChunkSize: 200,     // 子块大小
  childChunkOverlap: 50,   // 子块重叠
  minTokens: 20,           // 最小 tokens
}

// ========== 工具函数 ==========

/** 估算 token 数量 */
export function estimateTokens(text: string): number {
  const englishWords = (text.match(/\b\w+\b/g) || []).length
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  return Math.ceil(englishWords * 1.3 + chineseChars * 1.5)
}

/** 获取元素所属章节 */
function getSection(element: LayoutElement, currentSection: string): string {
  if (element.type === 'heading') {
    return element.text?.replace(/^#+\s*/, '').split('\n')[0] || currentSection
  }
  return currentSection
}

/** 判断是否应该创建新的父块组 */
function shouldCreateNewGroup(group: ParentGroup, element: LayoutElement): boolean {
  // 不同章节
  const elementSection = getSection(element, group.section)
  if (elementSection !== group.section) return true

  // 超出最大 tokens
  const newTokens = estimateTokens(group.content + '\n' + (element.text || ''))
  if (newTokens > CONFIG.parentMaxTokens) return true

  // 跨页（可选：根据需要决定是否跨页合并）
  if (element.page !== group.pageNumber) return true

  return false
}

/** 保存父块组：创建父块 + 切分子块 */
async function saveParentGroup(
  group: ParentGroup,
  pdfId: string,
  chunks: ParentChildChunk[],
  childSplitter: RecursiveCharacterTextSplitter
): Promise<void> {
  const parentId = `parent-${pdfId}-${chunks.length}`

  // 创建父块（完整内容）
  const parentChunk: ParentChildChunk = {
    id: parentId,
    pdfId,
    content: group.content.trim(),
    pageNumber: group.pageNumber,
    chunkIndex: chunks.length,
    elementType: 'paragraph_group',
    section: group.section,
    bbox: group.startBbox ? JSON.stringify(group.startBbox) : undefined,
    tokens: group.tokens,
    chunkRole: 'parent',
    groupKey: group.groupKey,
  }
  chunks.push(parentChunk)

  // 切分子块
  const childDocs = await childSplitter.splitText(group.content)
  const childIds: string[] = []

  for (let i = 0; i < childDocs.length; i++) {
    const childId = `child-${parentId}-${i}`
    childIds.push(childId)

    const childChunk: ParentChildChunk = {
      id: childId,
      pdfId,
      content: childDocs[i].trim(),
      pageNumber: group.pageNumber,
      chunkIndex: chunks.length,
      elementType: 'paragraph',
      section: group.section,
      bbox: group.startBbox ? JSON.stringify(group.startBbox) : undefined,
      tokens: estimateTokens(childDocs[i]),
      parentId: parentId,
      chunkRole: 'child',
      groupKey: group.groupKey,
    }
    chunks.push(childChunk)
  }

  // 更新父块的 childIds
  parentChunk.childIds = JSON.stringify(childIds)
}

// ========== 主函数：创建父子双块 ==========

export async function createParentChildChunks(
  pdfId: string,
  elements: LayoutElement[]
): Promise<ParentChildChunk[]> {
  console.log(`[ParentChildChunk] 开始创建父子双块，元素数: ${elements.length}`)

  const chunks: ParentChildChunk[] = []
  let parentGroup: ParentGroup | null = null
  let currentSection = ''

  // 初始化 LangChain 子块切分器
  const childSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: CONFIG.childChunkSize,
    chunkOverlap: CONFIG.childChunkOverlap,
    separators: ['\n\n', '\n', '. ', ' ', ''],
  })

  // 按 orderId 排序
  const sortedElements = [...elements].sort((a, b) => a.orderId - b.orderId)

  for (const element of sortedElements) {
    // 跳过页眉页脚
    if (['header', 'footer', 'page_number'].includes(element.type)) {
      continue
    }

    const text = element.text || ''
    if (!text.trim()) continue

    // 更新当前章节
    currentSection = getSection(element, currentSection)

    // 策略 1：标题/表格/图片 单独成父块（不切分）
    if (['heading', 'table', 'image', 'caption', 'equation'].includes(element.type)) {
      // 先保存之前的父块组
      if (parentGroup) {
        await saveParentGroup(parentGroup, pdfId, chunks, childSplitter)
        parentGroup = null
      }

      // 创建独立父块
      const parentId = `parent-${pdfId}-${chunks.length}`
      const parentChunk: ParentChildChunk = {
        id: parentId,
        pdfId,
        content: text,
        pageNumber: element.page,
        chunkIndex: chunks.length,
        elementType: element.type,
        section: currentSection,
        bbox: JSON.stringify(element.bbox),
        tokens: estimateTokens(text),
        chunkRole: 'both', // 既是父也是子（不切分）
        groupKey: `${element.type}-${element.page}-${chunks.length}`,
      }
      chunks.push(parentChunk)

      // 创建子块（与父块相同）
      const childId = `child-${parentId}-0`
      const childChunk: ParentChildChunk = {
        id: childId,
        pdfId,
        content: text,
        pageNumber: element.page,
        chunkIndex: chunks.length,
        elementType: element.type,
        section: currentSection,
        bbox: JSON.stringify(element.bbox),
        tokens: estimateTokens(text),
        parentId: parentId,
        chunkRole: 'child',
        groupKey: parentChunk.groupKey,
      }
      chunks.push(childChunk)

      // 更新父块的 childIds
      parentChunk.childIds = JSON.stringify([childId])

      continue
    }

    // 策略 2：段落累积到父块组
    if (!parentGroup || shouldCreateNewGroup(parentGroup, element)) {
      // 保存之前的组
      if (parentGroup) {
        await saveParentGroup(parentGroup, pdfId, chunks, childSplitter)
      }

      // 新组
      parentGroup = {
        elements: [element],
        content: text,
        tokens: estimateTokens(text),
        section: currentSection,
        pageNumber: element.page,
        groupKey: `section-${currentSection}-group-${chunks.length}`,
        startBbox: element.bbox,
      }
    } else {
      // 累积到当前组
      parentGroup.elements.push(element)
      parentGroup.content += '\n' + text
      parentGroup.tokens += estimateTokens(text)
    }
  }

  // 保存最后一个组
  if (parentGroup) {
    await saveParentGroup(parentGroup, pdfId, chunks, childSplitter)
  }

  // 重新编号 chunkIndex
  chunks.forEach((chunk, idx) => {
    chunk.chunkIndex = idx
  })

  // 统计
  const parentCount = chunks.filter(c => c.chunkRole === 'parent').length
  const childCount = chunks.filter(c => c.chunkRole === 'child').length
  const bothCount = chunks.filter(c => c.chunkRole === 'both').length

  console.log(`[ParentChildChunk] 完成: ${chunks.length} 个 chunks`)
  console.log(`  - 父块: ${parentCount}`)
  console.log(`  - 子块: ${childCount}`)
  console.log(`  - 独立块: ${bothCount}`)

  return chunks
}

// ========== 兼容旧接口的包装函数 ==========

export async function createSemanticChunksFromElements(
  pdfId: string,
  elements: LayoutElement[]
): Promise<{
  id: string
  pdfId: string
  pageNumber: number
  chunkIndex: number
  content: string
  elementType: string
  section?: string
  bbox?: string
  tokens: number
  parentId?: string
  childIds?: string
  chunkRole?: string
  groupKey?: string
}[]> {
  const chunks = await createParentChildChunks(pdfId, elements)

  // 转换为旧接口格式（兼容）
  return chunks.map(chunk => ({
    id: chunk.id,
    pdfId: chunk.pdfId,
    pageNumber: chunk.pageNumber,
    chunkIndex: chunk.chunkIndex,
    content: chunk.content,
    elementType: chunk.elementType,
    section: chunk.section,
    bbox: chunk.bbox,
    tokens: chunk.tokens,
    parentId: chunk.parentId,
    childIds: chunk.childIds,
    chunkRole: chunk.chunkRole,
    groupKey: chunk.groupKey,
  }))
}
