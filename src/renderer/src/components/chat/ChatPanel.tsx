import { useState, useRef, useEffect } from 'react'
import {
  Settings,
  Send,
  Paperclip,
  Image,
  FileText,
  MoreHorizontal,
  Bot,
  User,
  Sparkles,
  X,
  ChevronDown,
  Loader2,
  Check,
  Database,
  AlertCircle,
  Trash2,
  Copy,
  CheckCheck,
  ArrowUpDown,
  Save,
  Folder,
  Plus,
  Star,
} from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import AttachmentPreview, { AttachmentItem } from './AttachmentPreview'
import type { ModelConfig } from '../../types'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

// ========== RAG 上下文检索辅助 ==========

/** 当前活跃的 PDF tab 信息（用于 RAG） */
let currentPdfInfo: { pdfId: string; filePath: string } | null = null

/** 多轮对话上下文管理 */
let lastUserQuery: string | null = null
// ❌ 删除 lastChunks：历史 chunk = 噪声来源，会污染答案

// ========== 场景化 System Prompt ==========

/** 场景 1：语义检索有结果 - 强制基于上下文回答 */
const SYSTEM_PROMPT_WITH_CONTEXT = `你是用户的学术助手，正在帮助用户阅读 PDF 文档。

用户选中了 PDF 文档作为知识库，并且系统找到了与问题相关的段落。

**重要规则**：
1. 你必须严格基于下面提供的【相关段落】回答用户问题
2. 如果【相关段落】中没有足够信息回答问题，你必须明确告知用户"根据提供的文档内容，无法找到相关信息"
3. 不要基于你自己的知识补充回答，除非用户明确要求
4. 回答时引用具体的页码信息

【相关段落】：
{context}

请基于以上段落回答用户问题。`

/** 场景 2：语义检索无结果 - 允许基于通用知识回答 */
const SYSTEM_PROMPT_NO_CONTEXT = `你是用户的学术助手，正在帮助用户阅读 PDF 文档。

用户选中了 PDF 文档作为知识库，但系统**未能在文档中找到**与用户问题相关的内容。

**重要规则**：
1. 首先明确告知用户："根据提供的文档内容，未能找到相关信息"
2. 然后你可以基于自己的通用知识回答用户问题
3. 必须明确区分"文档内容"和"通用知识"两部分

请回答用户问题。`

/** 场景 3：摘要模式 - 全面总结全文 */
const SYSTEM_PROMPT_SUMMARY = `你是用户的学术助手，正在帮助用户阅读 PDF 文档。

用户希望了解文档的整体内容和主要观点。

**重要规则**：
1. 基于下面提供的【文档内容】进行全面总结
2. 如果提供了多个文档，请分别总结每个文档的主要内容，并说明它们之间的关系（如果有）
3. 总结应包括：研究背景、主要方法、关键发现、结论
4. 如果内容不足以全面总结，请说明局限性

【文档内容】：
{context}

请全面总结以上文档的主要内容。如果包含多个文档，请分别说明每个文档的核心内容。`

/** 判断是否是追问（包含指代词） */
function isFollowUp(query: string): boolean {
  // 指代词 + 追问词
  const pronouns = /这个|那个|它|他|她|这里|那里|上述|前面|刚才/i
  const followUpWords = /具体|详细|展开|再说|多讲|然后|那|呢|还有|为什么|怎么样|如何|什么意思|是什么|指的是/i

  return pronouns.test(query) || followUpWords.test(query)
}

/** 简单改写：处理追问（本地规则版） */
function simpleRewrite(query: string): string {
  if (!lastUserQuery) return query

  // 如果包含指代词，尝试替换
  const pronounMap: Record<string, string> = {
    '这个': lastUserQuery,
    '那个': lastUserQuery,
    '它': lastUserQuery,
    '他': lastUserQuery,
    '她': lastUserQuery,
  }

  let rewritten = query
  for (const [pronoun, replacement] of Object.entries(pronounMap)) {
    if (rewritten.includes(pronoun)) {
      rewritten = rewritten.replace(pronoun, replacement)
      console.log(`[RAG] 指代替换: "${query}" → "${rewritten}"`)
      return rewritten
    }
  }

  // 默认：拼接历史查询
  const combined = `${lastUserQuery} ${query}`
  console.log(`[RAG] 简单改写: "${query}" → "${combined}"`)
  return combined
}

/** 🧠 LLM Query Rewrite（异步，需要调用 AI） */
async function llmRewriteQuery(
  query: string,
  lastQuery: string | null,
  config: { provider: string; baseUrl: string; apiKey: string; model: string }
): Promise<string> {
  if (!lastQuery || !isFollowUp(query)) {
    return query
  }

  // 构建 rewrite prompt
  const prompt = `用户正在阅读一篇学术论文，这是多轮对话。

历史问题: "${lastQuery}"
当前问题: "${query}"

当前问题包含指代词（这个/那个/它/什么意思等），请将其改写为一个完整、独立的问题，消除所有指代歧义。

要求:
1. 用具体的名词替换"这个/那个/它"
2. 保持原问题的核心意图
3. 改写后的问题应该可以被独立理解
4. 不要添加额外信息，只改写指代部分

只输出改写后的问题，不要解释。`

  try {
    const result = await window.api.ai.chat({
      provider: config.provider,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      messages: [
        { role: 'system', content: '你是一个专业的查询改写助手，专门处理多轮对话中的指代消解。' },
        { role: 'user', content: prompt },
      ],
    })

    if (result.success && result.content) {
      const rewritten = result.content.trim()
      console.log(`[RAG] LLM Rewrite: "${query}" → "${rewritten}"`)
      return rewritten
    }
  } catch (err) {
    console.warn('[RAG] LLM rewrite 失败，回退到简单改写:', err)
  }

  // 失败时回退到简单改写
  return simpleRewrite(query)
}

/** 设置当前 PDF 信息（由 PDFViewer 调用） */
export function setCurrentPdfForRAG(pdfId: string, filePath: string): void {
  // 确保路径已标准化
  currentPdfInfo = { pdfId, filePath: normalizePath(filePath) }
  console.log(`[RAG] 设置当前PDF: ${filePath}`)
}

/** 获取当前 PDF 信息 */
export function getCurrentPdfForRAG(): { pdfId: string; filePath: string } | null {
  return currentPdfInfo
}

/** 获取 embedding 模型配置 - 强制要求 embeddingModel 字段 */
function getEmbeddingConfig(): { provider: string; baseUrl: string; apiKey: string; model: string } | null {
  const store = useAppStore.getState()
  const { modelConfigs, ragModelId } = store

  let selectedConfig: ModelConfig | null = null

  // 优先使用用户选择的 RAG 模型
  if (ragModelId) {
    selectedConfig = modelConfigs.find((c) => c.id === ragModelId && c.apiKey) || null
  }

  // 回退到默认模型配置
  if (!selectedConfig) {
    selectedConfig = modelConfigs.find((c) => c.isDefault && c.apiKey) || modelConfigs.find((c) => c.apiKey) || null
  }

  if (!selectedConfig) {
    console.error('[RAG] 未找到可用的模型配置')
    return null
  }

  // ✅ 关键修复：使用 embeddingModel 或 model 字段（兜底逻辑）
  const embeddingModel = selectedConfig.embeddingModel || selectedConfig.model

  if (!embeddingModel) {
    console.error('[RAG] 未配置 embeddingModel，请在设置中选择向量模型')
    return null
  }

  console.log('[RAG] 使用 embedding 模型:', embeddingModel)

  // ✅ 返回正确的配置结构
  return {
    provider: selectedConfig.provider,
    baseUrl: selectedConfig.baseUrl,
    apiKey: selectedConfig.apiKey,
    model: embeddingModel, // 👈 关键：使用 embeddingModel 或 model 作为 model
    embeddingModel: embeddingModel, // 👈 同时提供 embeddingModel 字段，确保后端兼容
  }
}

/** 从 store 的 pdfFullText 中解析每页文本 */
function parsePagesFromFullText(fullText: string): { pageNumber: number; text: string }[] {
  const pages: { pageNumber: number; text: string }[] = []
  const parts = fullText.split(/--- 第 (\d+) 页 ---/)
  console.log(`[RAG] 解析全文，共 ${parts.length} 个部分`)
  for (let i = 1; i < parts.length; i += 2) {
    const pageNum = parseInt(parts[i], 10)
    const text = (parts[i + 1] || '').trim()
    console.log(`[RAG] 第 ${pageNum} 页，文本长度: ${text.length}`)
    if (text) {
      pages.push({ pageNumber: pageNum, text })
    }
  }
  console.log(`[RAG] 解析完成，共 ${pages.length} 页有效内容`)
  return pages
}

/** 触发 RAG 索引（使用 OpenDataLoader） */
export async function triggerRAGIndex(
  pdfId: string,
  filePath: string,
  config: ModelConfig,
  force: boolean = false  // ✅ 新增：强制重新索引
): Promise<void> {
  // 检查新 API 是否可用
  if (!window.api?.rag?.indexPdfWithOpenDataLoader || !window.api?.rag?.getIndexStatus) {
    console.warn('[RAG] OpenDataLoader API 不可用')
    return
  }

  // 使用标准化后的文件路径作为唯一ID
  const uniquePdfId = `pdf-${normalizePath(filePath)}`
  console.log(`[RAG] 开始索引 (OpenDataLoader): ${filePath}`)

  const store = useAppStore.getState()
  if (store.ragIndexing) return

  // 检查是否已有索引（除非强制重新索引）
  if (!force) {
    try {
      const status = await window.api.rag.getIndexStatus(uniquePdfId)
      if (status.hasIndex) {
        console.log('[RAG] 已有索引，跳过（如需重新索引，请使用 force=true）')
        return
      }
    } catch {
      // 忽略
    }
  } else {
    console.log('[RAG] 强制重新索引模式')
  }

  // 获取 embedding 模型配置
  const embeddingConfig = getEmbeddingConfig()
  if (!embeddingConfig) {
    console.warn('未配置 embedding 模型，跳过 RAG 索引')
    return
  }

  store.setRagIndexing(true)
  try {
    console.log('[RAG] 调用 OpenDataLoader 处理 PDF...')
    console.log('[RAG] 索引配置:', {
      provider: embeddingConfig.provider,
      baseUrl: embeddingConfig.baseUrl,
      model: embeddingConfig.model,
    })

    // 使用新的 OpenDataLoader API
    const result = await window.api.rag.indexPdfWithOpenDataLoader({
      pdfId: uniquePdfId,
      filePath: normalizePath(filePath),
      config: {
        provider: embeddingConfig.provider,
        baseUrl: embeddingConfig.baseUrl,
        apiKey: embeddingConfig.apiKey,
        model: embeddingConfig.model,
        embeddingModel: embeddingConfig.embeddingModel,
      },
    })

    console.log(`[RAG] 索引结果:`, result)

    if (result.success) {
      // 更新索引状态
      const status = await window.api.rag.getIndexStatus(uniquePdfId)
      store.setRagIndexStatus(status)
      console.log(`[RAG] 索引状态更新:`, status)
      if (result.metadata) {
        console.log(`[RAG] 处理模式: ${result.metadata.mode}, 原因: ${result.metadata.reason}`)
      }
    } else {
      console.warn(`[RAG] 索引失败:`, result.message)
    }
  } catch (err) {
    console.warn('[RAG] 索引异常:', err)
  } finally {
    store.setRagIndexing(false)
  }
}

/** 标准化路径（统一使用正斜杠，并转为小写用于比较） */
export function normalizePathForRAG(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

/** 内部使用的路径标准化函数 */
function normalizePath(path: string): string {
  return normalizePathForRAG(path)
}

/** 摘要模式：智能选择 chunks 进行全面总结
 * 策略：标题 + 摘要 + 结论 + 开篇/结尾段落
 */
async function getSummaryContext(filePaths: string[]): Promise<RAGContextResult> {
  const allContent: string[] = []

  console.log(`[Summary] 开始处理 ${filePaths.length} 个文件的摘要:`, filePaths)

  for (const filePath of filePaths) {
    try {
      const pdfId = `pdf-${filePath}`
      const fileName = filePath.split(/[\\/]/).pop() || '未知文件'
      console.log(`[Summary] 处理文件: ${fileName}, pdfId: ${pdfId}`)

      // 检查索引状态
      if (window.api.rag.getIndexStatus) {
        const indexStatus = await window.api.rag.getIndexStatus(pdfId)
        console.log(`[Summary] 文件 ${fileName} 索引状态:`, indexStatus)
        if (!indexStatus.hasIndex) {
          console.warn(`[RAG] 文件 ${filePath} 尚未建立索引，跳过`)
          allContent.push(`\n【文件: ${fileName}】\n⚠️ 该文件尚未建立索引，无法读取内容`)
          continue
        }
      }

      // 获取所有 chunks，按类型智能选择
      const result = await window.api.rag.getTopChunks?.(pdfId, 100) // 获取足够多的 chunks
      console.log(`[Summary] 文件 ${fileName} getTopChunks 结果:`, result?.chunks?.length || 0, '个 chunks')

      if (result && result.chunks.length > 0) {
        // 调试：打印 type 分布
        const typeCounts = result.chunks.reduce((acc: any, c: any) => {
          acc[c.type || 'undefined'] = (acc[c.type || 'undefined'] || 0) + 1
          return acc
        }, {})
        console.log('[Summary] Chunks type 分布:', typeCounts)

        allContent.push(`\n【文件: ${fileName}】`)

        // 第一层：文档骨架（必取）- 标题和摘要
        const headings = result.chunks.filter((c: any) => c.type === 'heading' || c.type === 'abstract')
        if (headings.length > 0) {
          allContent.push('\n📌 文档结构：')
          headings.forEach((chunk: any) => {
            allContent.push(`第 ${chunk.pageNumber} 页 [${chunk.type}]: ${chunk.content}`)
          })
        }

        // 第二层：关键结论（必取）
        const conclusions = result.chunks.filter((c: any) => c.type === 'conclusion')
        if (conclusions.length > 0) {
          allContent.push('\n✅ 结论：')
          conclusions.forEach((chunk: any) => {
            allContent.push(`第 ${chunk.pageNumber} 页: ${chunk.content}`)
          })
        }

        // 第三层：开篇和结尾段落
        const paragraphs = result.chunks.filter((c: any) => c.type === 'paragraph')
        const firstPageParagraphs = paragraphs.filter((c: any) => c.pageNumber <= 2).slice(0, 3)
        const lastPageParagraphs = paragraphs.filter((c: any) => c.pageNumber >= Math.max(...result.chunks.map((c: any) => c.pageNumber)) - 1).slice(0, 3)

        if (firstPageParagraphs.length > 0) {
          allContent.push('\n📝 开篇内容：')
          firstPageParagraphs.forEach((chunk: any) => {
            allContent.push(`第 ${chunk.pageNumber} 页: ${chunk.content}`)
          })
        }

        if (lastPageParagraphs.length > 0) {
          allContent.push('\n🔚 结尾内容：')
          lastPageParagraphs.forEach((chunk: any) => {
            allContent.push(`第 ${chunk.pageNumber} 页: ${chunk.content}`)
          })
        }
      } else {
        // 没有获取到 chunks
        allContent.push(`\n【文件: ${fileName}】\n⚠️ 无法获取该文件的内容`)
      }
    } catch (err) {
      console.warn(`[RAG] 摘要模式失败 (${filePath}):`, err)
      const fileName = filePath.split(/[\\/]/).pop() || '未知文件'
      allContent.push(`\n【文件: ${fileName}】\n⚠️ 读取该文件时出错`)
    }
  }

  console.log(`[Summary] 最终生成内容长度: ${allContent.length} 个片段`)

  if (allContent.length > 0) {
    return {
      context: allContent.join('\n\n'),
      mode: 'summary'
    }
  }

  return { context: null, mode: 'no_context' }
}

/** 判断是否是通用知识问题（不针对 PDF） */
function isGeneralKnowledgeQuery(query: string): boolean {
  const q = query.trim().toLowerCase()
  
  // 明确询问 AI 的知识："你知道...吗"、"什么是..."、"解释一下..."
  const generalPatterns = /你知道|什么是|解释一下|告诉我关于|介绍一下/i
  
  // 如果匹配通用知识模式，且没有提到 PDF/文档/论文/文章
  const hasDocReference = /pdf|文档|论文|文章|这篇|该篇|此篇/i.test(q)
  
  if (generalPatterns.test(q) && !hasDocReference) {
    console.log('[RAG] 检测到通用知识问题，不走检索')
    return true
  }
  
  return false
}

/** 判断是否是泛问题（适合摘要模式） */
function isGenericQuery(query: string): boolean {
  const q = query.trim().toLowerCase()

  // 明确的摘要关键词（只有这些才算泛问题）
  const summaryKeywords = /讲什么|总结|summary|what is this paper about|这篇文章|这篇论文|主要内容|讲了什么/i

  // 如果有英文术语 + "是什么"，这是概念查询，不是泛问题
  const hasEnglishTerm = /[a-z]{3,}/i.test(query)
  const isConceptQuery = hasEnglishTerm && q.includes('是什么')

  if (isConceptQuery) {
    console.log('[RAG] 检测到概念查询（有英文术语），不走摘要模式')
    return false
  }

  // 只有明确的摘要关键词才算泛问题
  if (summaryKeywords.test(q)) {
    console.log('[RAG] 检测到摘要关键词，走摘要模式')
    return true
  }

  // 太短且无实体（少于6个字符且没有英文/数字）
  if (q.length < 6 && !/[a-z0-9]/i.test(q)) {
    console.log('[RAG] 查询太短，走摘要模式')
    return true
  }

  return false
}

/** RAG 返回结果类型 */
interface RAGContextResult {
  context: string | null
  mode: 'with_context' | 'no_context' | 'summary'
}

/** 获取 RAG 上下文（检索最相关分块）- 支持多文件和多轮对话
 * 返回包含 context 和 mode，用于选择不同的 system prompt
 */
async function getRAGContext(
  query: string,
  chatConfig?: { provider: string; baseUrl: string; apiKey: string; model: string }
): Promise<RAGContextResult> {
  if (!window.api?.rag?.search) {
    console.warn('[RAG] window.api.rag.search 不可用')
    return null
  }

  const store = useAppStore.getState()
  const knowledgeBaseFiles = store.knowledgeBaseFiles

  console.log(`[RAG] 知识库文件列表:`, knowledgeBaseFiles)
  console.log(`[RAG] 当前PDF信息:`, currentPdfInfo)

  // 如果没有选择任何文件，尝试使用当前打开的PDF
  // 注意：knowledgeBaseFiles 中的路径已经是标准化的
  const filesToSearch = knowledgeBaseFiles.length > 0
    ? knowledgeBaseFiles
    : (currentPdfInfo ? [normalizePath(currentPdfInfo.filePath)] : [])

  console.log(`[RAG] 待检索文件:`, filesToSearch)

  // 首先判断是否是通用知识问题（不针对 PDF）
  if (isGeneralKnowledgeQuery(query)) {
    console.log('[RAG] 通用知识问题，直接返回 no_context 模式')
    return { context: null, mode: 'no_context' }
  }

  if (filesToSearch.length === 0) {
    console.warn('[RAG] 没有文件可检索')
    return { context: null, mode: 'no_context' }
  }

  // 🧠 LLM Query Rewrite（处理追问和指代）
  let finalQuery: string
  if (chatConfig && isFollowUp(query)) {
    finalQuery = await llmRewriteQuery(query, lastUserQuery, chatConfig)
  } else {
    finalQuery = simpleRewrite(query)
  }
  console.log(`[RAG] 原始查询: "${query}"`)
  console.log(`[RAG] 最终查询: "${finalQuery}"`)

  // 判断是否是泛问题，走摘要模式
  if (isGenericQuery(finalQuery)) {
    console.log('[RAG] 检测到泛问题，走摘要模式')
    const summaryResult = await getSummaryContext(filesToSearch)
    return summaryResult
  }

  // 获取 embedding 模型配置
  const embeddingConfig = getEmbeddingConfig()
  if (!embeddingConfig) {
    console.warn('[RAG] 未配置 embedding 模型')
    return { context: null, mode: 'no_context' }
  }

  // 使用新的多文档检索接口
  const pdfIds = filesToSearch.map(filePath => `pdf-${filePath}`)
  console.log(`[RAG] 使用多文档检索，文档数量: ${pdfIds.length}`)

  // 构建 Reranker 配置（如果选择了 Reranker 模型）
  const rerankerConfig = rerankerModel ? {
    model: rerankerModel.model,
    apiKey: rerankerModel.apiKey,
    baseUrl: rerankerModel.baseUrl,
  } : undefined

  let allChunks: { fileName: string; pageNumber: number; score: number; content: string; type?: string; section?: string }[] = []

  try {
    // 优先使用多文档检索接口
    if (window.api.rag.searchMulti && pdfIds.length > 1) {
      console.log('[RAG] 使用 searchMulti 接口')
      const result = await window.api.rag.searchMulti({
        pdfIds,
        query: finalQuery,
        config: {
          provider: embeddingConfig.provider,
          baseUrl: embeddingConfig.baseUrl,
          apiKey: embeddingConfig.apiKey,
          model: embeddingConfig.model,
          embeddingModel: embeddingConfig.embeddingModel,
        },
        topK: 10, // 总共检索前10个最相关的分块
      })

      console.log(`[RAG] 多文档检索结果:`, result)

      if (result.success && result.chunks.length > 0) {
        result.chunks.forEach((chunk) => {
          const filePath = filesToSearch.find(f => `pdf-${f}` === chunk.pdfId) || ''
          const fileName = filePath.split(/[\\/]/).pop() || chunk.fileName || '未知文件'
          allChunks.push({
            fileName,
            pageNumber: chunk.pageNumber,
            score: chunk.score,
            content: chunk.content,
            type: chunk.type,
            section: chunk.section,
          })
        })
      } else if (!result.success) {
        console.warn(`[RAG] 多文档检索失败: ${result.message}`)
      }

      // 如果有缺失的文档，回退到单文档检索
      if (result.missingPdfIds && result.missingPdfIds.length > 0) {
        console.warn(`[RAG] 以下文档未索引，尝试单文档检索: ${result.missingPdfIds.join(', ')}`)
        // 继续执行下面的单文档检索逻辑
        allChunks = []
      }
    }

    // 如果多文档检索失败或只有一个文档，使用单文档检索
    if (allChunks.length === 0) {
      console.log('[RAG] 使用单文档检索')
      for (const filePath of filesToSearch) {
        try {
          const pdfId = `pdf-${filePath}`
          console.log(`[RAG] 检索文件: ${filePath}, pdfId: ${pdfId}`)

          // 先检查索引状态
          if (window.api.rag.getIndexStatus) {
            const indexStatus = await window.api.rag.getIndexStatus(pdfId)
            if (!indexStatus.hasIndex) {
              console.warn(`[RAG] 文件 ${filePath} 尚未建立索引`)
              continue
            }
          }

          const result = await window.api.rag.search({
            pdfId,
            query: finalQuery,
            config: {
              provider: embeddingConfig.provider,
              baseUrl: embeddingConfig.baseUrl,
              apiKey: embeddingConfig.apiKey,
              model: embeddingConfig.model,
              embeddingModel: embeddingConfig.embeddingModel,
            },
            topK: 3,
            rerankerConfig,
          })

          if (result.success && result.chunks.length > 0) {
            const fileName = filePath.split(/[\\/]/).pop() || '未知文件'
            result.chunks.forEach((chunk) => {
              allChunks.push({
                fileName,
                pageNumber: chunk.pageNumber,
                score: chunk.score,
                content: chunk.content,
              })
            })
          }
        } catch (err) {
          console.warn(`[RAG] 检索异常 (${filePath}):`, err)
        }
      }
    }
  } catch (err) {
    console.warn('[RAG] 多文档检索异常，回退到单文档检索:', err)
    // 回退到单文档检索
    for (const filePath of filesToSearch) {
      try {
        const pdfId = `pdf-${filePath}`
        const result = await window.api.rag.search({
          pdfId,
          query: finalQuery,
          config: {
            provider: embeddingConfig.provider,
            baseUrl: embeddingConfig.baseUrl,
            apiKey: embeddingConfig.apiKey,
            model: embeddingConfig.model,
            embeddingModel: embeddingConfig.embeddingModel,
          },
          topK: 3,
          rerankerConfig,
        })

        if (result.success && result.chunks.length > 0) {
          const fileName = filePath.split(/[\\/]/).pop() || '未知文件'
          result.chunks.forEach((chunk) => {
            allChunks.push({
              fileName,
              pageNumber: chunk.pageNumber,
              score: chunk.score,
              content: chunk.content,
            })
          })
        }
      } catch (err) {
        console.warn(`[RAG] 检索异常 (${filePath}):`, err)
      }
    }
  }

  // 按相关度排序并取前10个
  allChunks.sort((a, b) => b.score - a.score)
  const topChunks = allChunks.slice(0, 10)

  // ✅ 只保存用户查询，不保存历史 chunks（避免噪声）
  lastUserQuery = query

  // 🧠 智能上下文组装（只用当前检索结果，不混合历史）
  const mergedChunks = topChunks.slice(0, 8)

  if (mergedChunks.length > 0) {
    // 按章节分组
    const sectionGroups: Record<string, typeof mergedChunks> = {}
    for (const chunk of mergedChunks) {
      const section = chunk.section || '未分类'
      if (!sectionGroups[section]) sectionGroups[section] = []
      sectionGroups[section].push(chunk)
    }

    // 构建结构化上下文
    const contextParts: string[] = []

    for (const [section, chunks] of Object.entries(sectionGroups)) {
      // 章节标题
      if (section !== '未分类') {
        contextParts.push(`\n【章节: ${section}】`)
      }

      // 按类型排序：标题 > 摘要 > 结论 > 其他
      const typeOrder: Record<string, number> = {
        'heading': 0,
        'abstract': 1,
        'conclusion': 2,
        'paragraph': 3,
        'caption': 4,
        'equation': 5,
        'table': 6,
      }
      chunks.sort((a, b) => (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99))

      // 组装内容
      for (const chunk of chunks) {
        const typeLabel: Record<string, string> = {
          'heading': '📌 标题',
          'abstract': '📝 摘要',
          'conclusion': '✅ 结论',
          'paragraph': '📄',
          'caption': '📊 图表说明',
          'equation': '🔢 公式',
          'table': '📋 表格',
        }
        const label = typeLabel[chunk.type] || '📄'
        contextParts.push(
          `[${chunk.fileName} - ${label} - 第 ${chunk.pageNumber} 页，相关度: ${(chunk.score * 100).toFixed(0)}%]\n${chunk.content}`
        )
      }
    }

    console.log(`[RAG] 结构化上下文: ${mergedChunks.length} 个 chunks（已删除历史混合）`)
    console.log(`[RAG] 章节分布:`, Object.keys(sectionGroups))

    return { context: contextParts.join('\n\n---\n\n'), mode: 'with_context' }
  }

  console.warn('[RAG] 没有找到任何相关分块')
  return { context: null, mode: 'no_context' }
}

export default function ChatPanel({ width }: { width: number }): JSX.Element {
  const {
    chatSessions,
    activeChatSessionId,
    createChatSession,
    switchChatSession,
    addMessageToSession,
    updateChatSessionTitle,
    pendingAttachment,
    setPendingAttachment,
    pdfFullText,
    ragIndexStatus,
    setRagIndexStatus,
    ragIndexing,
    setRagIndexing,
    knowledgeBaseFiles,
    modelConfigs,
    ragModelId,
    setRagModelId,
    rerankerModelId,
    setRerankerModelId,
    chatSessionsLoaded,
  } = useAppStore()

  // 获取当前活跃会话
  const activeSession = chatSessions.find((s) => s.id === activeChatSessionId)
  const messages = activeSession?.messages || []

  // 如果没有活跃会话，自动创建一个或选择第一个
  useEffect(() => {
    // 等待会话数据加载完成
    if (!chatSessionsLoaded) return
    
    if (!activeChatSessionId) {
      if (chatSessions.length > 0) {
        // 如果有会话但没有活跃会话，选择第一个
        switchChatSession(chatSessions[0].id)
      } else {
        // 如果没有会话，创建一个新的
        createChatSession('新对话')
      }
    }
  }, [activeChatSessionId, chatSessions.length, createChatSession, switchChatSession, chatSessionsLoaded])
  const [inputValue, setInputValue] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [showPromptMenu, setShowPromptMenu] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 模型选择
  const [activeConfigId, _setActiveConfigId] = useState<string | null>(() => {
    // 从 localStorage 恢复上次选择的模型
    try { return localStorage.getItem('chatActiveConfigId') } catch { return null }
  })
  const [showModelMenu, setShowModelMenu] = useState(false)

  // RAG 和 Reranker 模型选择现在从全局 store 获取
  const [showRagModelMenu, setShowRagModelMenu] = useState(false)
  const [showRerankerModelMenu, setShowRerankerModelMenu] = useState(false)

  // 更多菜单
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  // 页码范围选择
  const [showPageRangeModal, setShowPageRangeModal] = useState(false)

  // 保存对话框
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [newFolderNameInput, setNewFolderNameInput] = useState('')

  // Agent 模式开关 - 默认开启
  const [useAgentMode, _setUseAgentMode] = useState<boolean>(() => {
    // 从 localStorage 恢复上次的选择，如果没有设置则默认为 true
    try {
      const saved = localStorage.getItem('useAgentMode')
      return saved === null ? true : saved === 'true'
    } catch { return true }
  })

  // 包装 setUseAgentMode，同时持久化到 localStorage
  const setUseAgentMode = (use: boolean) => {
    _setUseAgentMode(use)
    try {
      localStorage.setItem('useAgentMode', use.toString())
    } catch {}
  }

  // 包装 setActiveConfigId，同时持久化到 localStorage
  const setActiveConfigId = (id: string | null) => {
    _setActiveConfigId(id)
    try {
      if (id) localStorage.setItem('chatActiveConfigId', id)
      else localStorage.removeItem('chatActiveConfigId')
    } catch {}
  }

  // 同步 activeConfigId 与 modelConfigs 变化
  useEffect(() => {
    if (modelConfigs.length === 0) {
      _setActiveConfigId(null)
      return
    }
    
    // 如果没有选择模型，自动选择默认或第一个
    if (!activeConfigId) {
      const defaultModel = modelConfigs.find((m) => m.isDefault) || modelConfigs[0]
      if (defaultModel) {
        setActiveConfigId(defaultModel.id)
      }
      return
    }
    
    // 如果当前选择的模型不在列表中，切换到默认或第一个
    if (!modelConfigs.find((m) => m.id === activeConfigId)) {
      const defaultModel = modelConfigs.find((m) => m.isDefault) || modelConfigs[0]
      setActiveConfigId(defaultModel?.id || null)
    }
  }, [modelConfigs, activeConfigId])

  const [isLoading, setIsLoading] = useState(false)
  const [activePrompt, setActivePrompt] = useState('结合上下文，重点讲解红框内容')

  const activeConfig = modelConfigs.find((c) => c.id === activeConfigId)
  const ragModel = modelConfigs.find((c) => c.id === ragModelId)
  const rerankerModel = modelConfigs.find((c) => c.id === rerankerModelId)

  // 消费 pendingAttachment（由工具栏截图/附页触发）
  useEffect(() => {
    console.log('[ChatPanel] pendingAttachment 变化:', pendingAttachment)
    if (pendingAttachment) {
      console.log('[ChatPanel] 添加附件到列表:', pendingAttachment)
      setAttachments((prev) => [...prev, {
        id: pendingAttachment.id,
        type: pendingAttachment.type,
        label: pendingAttachment.label,
        pageNumbers: pendingAttachment.pageNumbers,
        data: pendingAttachment.data,
      }])
      setPendingAttachment(null)
    }
  }, [pendingAttachment, setPendingAttachment])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-rag-menu]') && !target.closest('[data-model-menu]') && !target.closest('[data-reranker-menu]')) {
        setShowRagModelMenu(false)
        setShowModelMenu(false)
        setShowRerankerModelMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSend = async () => {
    if (!inputValue.trim() && attachments.length === 0 && !activePrompt) return
    if (isLoading) return

    // 将附件内容拼入用户消息，确保 AI 能看到选中的文字/截图等
    const textParts: string[] = []
    const imageParts: { type: 'image_url'; image_url: { url: string } }[] = []

    for (const att of attachments) {
      if (!att.data) continue
      if (att.type === 'selection') {
        textParts.push(`【选中文本】\n${att.data}`)
      } else if (att.type === 'screenshot') {
        // 截图：仅将图片传给 AI，不附加文字标签
        if (att.data.startsWith('data:image')) {
          imageParts.push({ type: 'image_url', image_url: { url: att.data } })
        }
      } else if (att.type === 'page') {
        textParts.push(`【当前页：${att.label}】\n${att.data}`)
      } else if (att.type === 'range') {
        textParts.push(`【页码范围：${att.label}】\n${att.data}`)
      } else {
        textParts.push(`【附件：${att.label}】\n${att.data}`)
      }
    }

    const inputText = inputValue.trim() || activePrompt || '请解释以下内容'
    const hasImages = imageParts.length > 0

    // 构建用户消息内容：有图片时使用多模态格式，否则纯文本
    let userContent: string | { type: string; text?: string; image_url?: { url: string } }[]
    if (hasImages) {
      const contentParts: { type: string; text?: string; image_url?: { url: string } }[] = []
      const textContent = textParts.length > 0
        ? `${textParts.join('\n\n')}\n\n${inputText}`
        : inputText
      contentParts.push({ type: 'text', text: textContent })
      contentParts.push(...imageParts)
      userContent = contentParts
    } else {
      userContent = textParts.length > 0
        ? `${textParts.join('\n\n')}\n\n${inputText}`
        : inputText
    }

    // 显示在聊天中的文本版本
    const displayContent = typeof userContent === 'string'
      ? userContent
      : userContent.filter((p) => p.type === 'text').map((p) => p.text).join('\n')

    // 保存附件到消息中（用于渲染图片预览）
    const messageAttachments = attachments.length > 0 ? [...attachments] : undefined

    if (!activeChatSessionId) return
    addMessageToSession(activeChatSessionId, {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: displayContent,
      attachments: messageAttachments,
      timestamp: Date.now(),
    })
    setInputValue('')
    setAttachments([])

    // 如果有模型配置，调用真实 AI
    if (activeConfig && activeConfig.apiKey) {
      setIsLoading(true)
      try {
        // 添加调试日志
        console.log('[Chat] 检查模式:', { useAgentMode, hasAgentQuery: !!window.api?.rag?.agentQuery })
        
        // Agent 模式
        if (useAgentMode && window.api?.rag?.agentQuery) {
          console.log('[Chat] 使用 Agent 模式')
          const store = useAppStore.getState()
          const knowledgeBaseFiles = store.knowledgeBaseFiles

          // 提取图片数据
          const imageUrls = imageParts.map(p => p.image_url.url)
          const queryText = typeof userContent === 'string' ? userContent : userContent.map(p => p.text || '').join(' ')

          // 获取 embedding 模型配置
          const embeddingConfig = getEmbeddingConfig()

          // 准备历史对话（不包含当前这条）
          const history = messages
            .slice(-6) // 取最近 3 轮对话
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role, content: m.content }))

          // 处理多个文件的情况
          if (knowledgeBaseFiles.length > 1 && window.api.rag.agentQueryMulti) {
            // 多文档 Agent 模式
            console.log('[Chat] 使用多文档 Agent 模式，文件数量:', knowledgeBaseFiles.length)
            const pdfIds = knowledgeBaseFiles.map(f => `pdf-${normalizePath(f)}`)

            const result = await window.api.rag.agentQueryMulti({
              pdfIds,
              query: queryText,
              config: {
                provider: activeConfig.provider,
                baseUrl: activeConfig.baseUrl,
                apiKey: activeConfig.apiKey,
                model: activeConfig.model,
                embeddingModel: embeddingConfig?.embeddingModel || embeddingConfig?.model,
                webSearchApiKey: store.webSearchApiKey
              },
              history,
              images: imageUrls.length > 0 ? imageUrls : undefined
            })

            if (result.steps) {
              console.log('[Agent Multi] 工具调用步骤:', JSON.stringify(result.steps, null, 2))
            }

            if (activeChatSessionId) {
              addMessageToSession(activeChatSessionId, {
                id: `msg-${Date.now() + 1}`,
                role: 'assistant',
                content: result.success ? result.output! : `❌ ${result.message || 'Agent 执行失败'}`,
                timestamp: Date.now(),
              })
            }
          } else if (knowledgeBaseFiles.length > 0) {
            // 单文档 Agent 模式（只有一个文件）
            const pdfId = `pdf-${normalizePath(knowledgeBaseFiles[0])}`

            const result = await window.api.rag.agentQuery({
              pdfId,
              query: queryText,
              config: {
                provider: activeConfig.provider,
                baseUrl: activeConfig.baseUrl,
                apiKey: activeConfig.apiKey,
                model: activeConfig.model,
                embeddingModel: embeddingConfig?.embeddingModel || embeddingConfig?.model,
                webSearchApiKey: store.webSearchApiKey
              },
              history,
              images: imageUrls.length > 0 ? imageUrls : undefined
            })

            if (activeChatSessionId) {
              addMessageToSession(activeChatSessionId, {
                id: `msg-${Date.now() + 1}`,
                role: 'assistant',
                content: result.success ? result.output! : `❌ ${result.message || 'Agent 执行失败'}`,
                timestamp: Date.now(),
              })
            }
          } else if (currentPdfInfo) {
            // 如果没有选择知识库文件，使用当前打开的 PDF
            const pdfId = `pdf-${normalizePath(currentPdfInfo.filePath)}`

            const result = await window.api.rag.agentQuery({
              pdfId,
              query: queryText,
              config: {
                provider: activeConfig.provider,
                baseUrl: activeConfig.baseUrl,
                apiKey: activeConfig.apiKey,
                model: activeConfig.model,
                embeddingModel: embeddingConfig?.embeddingModel || embeddingConfig?.model,
                webSearchApiKey: store.webSearchApiKey
              },
              history,
              images: imageUrls.length > 0 ? imageUrls : undefined
            })

            if (activeChatSessionId) {
              addMessageToSession(activeChatSessionId, {
                id: `msg-${Date.now() + 1}`,
                role: 'assistant',
                content: result.success ? result.output! : `❌ ${result.message || 'Agent 执行失败'}`,
                timestamp: Date.now(),
              })
            }
          } else {
            // 没有 PDF 可用时的提示
            if (activeChatSessionId) {
              addMessageToSession(activeChatSessionId, {
                id: `msg-${Date.now() + 1}`,
                role: 'assistant',
                content: '⚠️ Agent 模式需要打开 PDF 文档或选择知识库文件。请先打开一个 PDF 文件。',
                timestamp: Date.now(),
              })
            }
          }
        } else if (window.api?.ai?.chat) {
          // 原有的普通模式
          console.log('[Chat] 使用普通模式')
          // 构建消息上下文，content 支持字符串或多模态数组
          const contextMessages: { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }[] = []

          // 获取当前知识库选择状态
          const store = useAppStore.getState()
          const knowledgeBaseFiles = store.knowledgeBaseFiles
          const hasKnowledgeBase = knowledgeBaseFiles.length > 0

          // RAG：只检索用户选中的文件（传入 chatConfig 用于 LLM rewrite）
          const queryText = typeof userContent === 'string' ? userContent : userContent.map(p => p.text || '').join(' ')
          const ragResult = await getRAGContext(
            queryText,
            activeConfig ? {
              provider: activeConfig.provider,
              baseUrl: activeConfig.baseUrl,
              apiKey: activeConfig.apiKey,
              model: activeConfig.model,
            } : undefined
          )
          
          // 根据 RAG 结果模式选择不同的 system prompt
          if (ragResult.mode === 'with_context' && ragResult.context) {
            // 场景 1：检索有结果，强制基于上下文回答
            contextMessages.push({
              role: 'system',
              content: SYSTEM_PROMPT_WITH_CONTEXT.replace('{context}', ragResult.context),
            })
          } else if (ragResult.mode === 'summary' && ragResult.context) {
            // 场景 3：摘要模式，全面总结
            contextMessages.push({
              role: 'system',
              content: SYSTEM_PROMPT_SUMMARY.replace('{context}', ragResult.context),
            })
          } else if (hasKnowledgeBase) {
            // 场景 2：用户选择了文件但检索不到相关内容，允许基于通用知识回答
            contextMessages.push({
              role: 'system',
              content: SYSTEM_PROMPT_NO_CONTEXT,
            })
          }
          // 注意：如果没有选中任何文件，不注入任何PDF上下文，AI只能基于自身知识回答

          // 只保留最近 3 条消息作为短期上下文（避免长期记忆）
          // 并且只保留 user 和 assistant 消息，不保留 system 消息
          const recentMessages = messages
            .slice(-3)
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role, content: m.content }))

          contextMessages.push(...recentMessages)
          contextMessages.push({ role: 'user' as const, content: userContent })
          const result = await window.api.ai.chat({
            provider: activeConfig.provider,
            baseUrl: activeConfig.baseUrl,
            apiKey: activeConfig.apiKey,
            model: activeConfig.model,
            messages: contextMessages,
          })
          if (activeChatSessionId) {
            addMessageToSession(activeChatSessionId, {
              id: `msg-${Date.now() + 1}`,
              role: 'assistant',
              content: result.success ? result.content! : `❌ ${result.message || '请求失败'}`,
              timestamp: Date.now(),
            })
          }
        }
      } catch (err: any) {
        if (activeChatSessionId) {
          addMessageToSession(activeChatSessionId, {
            id: `msg-${Date.now() + 1}`,
            role: 'assistant',
            content: `❌ 请求异常: ${err.message || '未知错误'}`,
            timestamp: Date.now(),
          })
        }
      } finally {
        setIsLoading(false)
      }
    } else if (!activeConfig || !activeConfig.apiKey) {
      if (activeChatSessionId) {
        addMessageToSession(activeChatSessionId, {
          id: `msg-${Date.now() + 1}`,
          role: 'assistant',
          content: '⚠️ 未配置 AI 模型。请点击右上角设置按钮配置 API Key 后再试。',
          timestamp: Date.now(),
        })
      }
    } else {
      // fallback: 模拟回复
      setTimeout(() => {
        if (activeChatSessionId) {
          addMessageToSession(activeChatSessionId, {
            id: `msg-${Date.now() + 1}`,
            role: 'assistant',
            content: '⚠️ AI 服务暂不可用，请重启应用后再试。',
            timestamp: Date.now(),
          })
        }
      }, 500)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  // 处理粘贴事件（支持粘贴截图）
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (blob) {
          const reader = new FileReader()
          reader.onload = (event) => {
            const dataUrl = event.target?.result as string
            if (dataUrl) {
              setAttachments((prev) => [...prev, {
                id: `screenshot-${Date.now()}`,
                type: 'screenshot',
                label: '粘贴的截图',
                data: dataUrl
              }])
            }
          }
          reader.readAsDataURL(blob)
        }
      }
    }
  }

  const addAttachment = (type: AttachmentItem['type'], label: string) => {
    setAttachments((prev) => [...prev, { id: `att-${Date.now()}`, type, label }])
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const promptOptions = [
    '解释这段话的意思',
    '总结本章内容',
    '翻译为中文',
    '提取关键信息',
    '结合上下文，重点讲解红框内容',
  ]

  return (
    <>
    <aside style={{ width: `${width}px` }} className="bg-dark-800 border-l border-dark-500 flex flex-col shrink-0">
      {/* 面板头部 */}
      <div className="h-12 flex items-center px-4 border-b border-dark-500 justify-between shrink-0">
        <div className="flex items-center gap-2">
          {/* AI 助手图标 - 点击显示模型选择下拉菜单 */}
          <div className="relative" data-model-menu>
            <button
              onClick={() => setShowModelMenu(!showModelMenu)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-dark-200 hover:bg-dark-700 hover:text-white transition-colors text-xs"
              title="选择模型"
            >
              <Bot className="w-5 h-5 text-accent" />
              <span className="font-medium text-white text-sm">AI 助手</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            {showModelMenu && (
              <div className="absolute left-0 top-9 w-52 bg-dark-700 border border-dark-500 rounded-lg shadow-xl z-20 py-1">
                {modelConfigs.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-dark-300">暂无模型配置</div>
                ) : (
                  modelConfigs.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => {
                        setActiveConfigId(model.id)
                        setShowModelMenu(false)
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs text-dark-100 hover:bg-dark-600 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Bot className="w-3 h-3 text-dark-300 shrink-0" />
                        <span className="truncate">{model.name || model.model}</span>
                      </div>
                      {model.id === activeConfigId && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                    </button>
                  ))
                )}
                <div className="border-t border-dark-500 mt-1 pt-1">
                  <button
                    onClick={() => {
                      setShowModelMenu(false)
                      // 触发打开设置弹窗的事件
                      window.dispatchEvent(new CustomEvent('open-settings'))
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-dark-300 hover:bg-dark-600 hover:text-white transition-colors"
                  >
                    <Settings className="w-3 h-3" />
                    管理模型配置...
                  </button>
                </div>
              </div>
            )}
          </div>
          {/* RAG 状态指示 */}
          {ragIndexing && (
            <span className="flex items-center gap-1 text-[10px] text-accent/80 bg-accent/10 px-1.5 py-0.5 rounded">
              <Loader2 className="w-3 h-3 animate-spin" />
              索引中
            </span>
          )}
          {!ragIndexing && ragIndexStatus?.hasIndex && (
            <span className="flex items-center gap-1 text-[10px] text-green-400/80 bg-green-400/10 px-1.5 py-0.5 rounded" title={`已索引 ${ragIndexStatus.totalChunks} 个分块，其中 ${ragIndexStatus.embeddedChunks} 个含向量`}>
              <Database className="w-3 h-3" />
              RAG
            </span>
          )}
          {/* 移除了 pdfFullText fallback，现在只使用 RAG 检索选中的文件 */}
        </div>
        <div className="flex items-center gap-1">
          {/* 保存按钮 */}
          <button
            onClick={() => setShowSaveDialog(true)}
            className="p-1.5 rounded-md text-dark-200 hover:bg-dark-700 hover:text-white transition-colors"
            title="保存对话"
          >
            <Save className="w-4 h-4" />
          </button>

          {/* 新建对话按钮 */}
          <button
            onClick={() => {
              // 创建新对话，旧对话会自动保留在最近对话中
              createChatSession('新对话')
            }}
            className="p-1.5 rounded-md text-dark-200 hover:bg-dark-700 hover:text-white transition-colors"
            title="新建对话"
          >
            <Plus className="w-4 h-4" />
          </button>

          {/* 更多菜单按钮 */}
          <div className="relative" data-more-menu>
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="p-1.5 rounded-md text-dark-200 hover:bg-dark-700 hover:text-white transition-colors"
              title="更多"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {showMoreMenu && (
              <div className="absolute right-0 top-8 w-56 bg-dark-700 border border-dark-500 rounded-lg shadow-xl z-30 py-1">
                {/* RAG 模型选择 */}
                <div className="px-3 py-1.5 text-[10px] text-dark-400 border-b border-dark-500">
                  RAG 向量模型
                </div>
                {modelConfigs.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-dark-300">暂无模型配置</div>
                ) : (
                  modelConfigs.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => {
                        setRagModelId(model.id)
                        setShowMoreMenu(false)
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs text-dark-100 hover:bg-dark-600 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Database className="w-3 h-3 text-dark-300 shrink-0" />
                        <span className="truncate">{model.name || model.model}</span>
                      </div>
                      {model.id === ragModelId && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                    </button>
                  ))
                )}
                <div className="border-t border-dark-500 mt-1 pt-1">
                  <button
                    onClick={() => {
                      setRagModelId(null)
                      setShowMoreMenu(false)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-dark-300 hover:bg-dark-600 hover:text-white transition-colors"
                  >
                    <X className="w-3 h-3" />
                    清除 RAG 选择
                  </button>
                </div>

                {/* 分隔线 */}
                <div className="border-t border-dark-500 my-1" />

                {/* Reranker 模型选择 */}
                <div className="px-3 py-1.5 text-[10px] text-dark-400 border-b border-dark-500">
                  Reranker 重排序模型
                </div>
                {modelConfigs.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-dark-300">暂无模型配置</div>
                ) : (
                  modelConfigs.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => {
                        setRerankerModelId(model.id)
                        setShowMoreMenu(false)
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs text-dark-100 hover:bg-dark-600 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ArrowUpDown className="w-3 h-3 text-dark-300 shrink-0" />
                        <span className="truncate">{model.name || model.model}</span>
                      </div>
                      {model.id === rerankerModelId && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                    </button>
                  ))
                )}
                <div className="border-t border-dark-500 mt-1 pt-1">
                  <button
                    onClick={() => {
                      setRerankerModelId(null)
                      setShowMoreMenu(false)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-dark-300 hover:bg-dark-600 hover:text-white transition-colors"
                  >
                    <X className="w-3 h-3" />
                    清除 Reranker 选择
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 系统提示词区域 */}
      <div className="px-3 py-2 border-b border-dark-500 shrink-0 relative">
        <button
          onClick={() => setShowPromptMenu(!showPromptMenu)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-dark-700/50 hover:bg-dark-700 text-xs text-dark-200 transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5 text-accent" />
          <span className="truncate flex-1 text-left">提示词：{activePrompt}</span>
        </button>
        {showPromptMenu && (
          <div className="absolute left-3 right-3 top-12 bg-dark-700 border border-dark-500 rounded-lg shadow-xl z-10 py-1">
            {promptOptions.map((opt, i) => (
              <button
                key={i}
                onClick={() => {
                  setActivePrompt(opt)
                  setShowPromptMenu(false)
                }}
                className={`w-full text-left px-3 py-2 text-xs transition-colors ${activePrompt === opt ? 'text-accent bg-dark-600' : 'text-dark-100 hover:bg-dark-600'}`}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 保存对话框 */}
      {showSaveDialog && activeSession && (
        <SaveDialog
          session={activeSession}
          onClose={() => setShowSaveDialog(false)}
        />
      )}

      {/* 对话内容区 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <ChatMessageItem key={msg.id} message={msg} onPreviewImage={setPreviewImage} />
        ))}
      </div>

      {/* 附件预览 */}
      <AttachmentPreview
        attachments={attachments}
        onRemove={removeAttachment}
        onPreview={(id) => {
          const att = attachments.find((a) => a.id === id)
          if (!att) return
          if (att.type === 'selection' && att.data) {
            setPreviewText(att.data)
          } else if (att.type === 'screenshot' && att.data) {
            setPreviewImage(att.data)
          }
          // range类型和page类型不需要预览
        }}
      />

      {/* 输入框 */}
      <div className="p-3 border-t border-dark-500 shrink-0">
        <div className="bg-dark-700 rounded-xl p-3 space-y-2">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            placeholder="输入问题，支持附加当前页面，粘贴截图..."
            className="w-full bg-transparent text-sm text-dark-100 placeholder-dark-300 resize-none outline-none min-h-[40px] max-h-[120px]"
            rows={1}
          />
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  // 触发PDF当前页截图
                  window.dispatchEvent(new CustomEvent('capture-current-page', { detail: { source: 'toolbar' } }))
                }}
                className="p-1.5 rounded-md text-dark-300 hover:bg-dark-600 hover:text-white transition-colors"
                title="截取当前页"
              >
                <Image className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowPageRangeModal(true)}
                className="p-1.5 rounded-md text-dark-300 hover:bg-dark-600 hover:text-white transition-colors"
                title="附加页码范围"
              >
                <Paperclip className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={handleSend}
              disabled={isLoading || (!inputValue.trim() && attachments.length === 0 && !activePrompt)}
              className="bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
            >
              {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {isLoading ? '思考中...' : '发送'}
            </button>
          </div>
        </div>
      </div>
    </aside>

      {/* 截图预览弹窗 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-[80vw] max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <img
              src={previewImage}
              alt="截图预览"
              className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-dark-700 hover:bg-red-500 text-white flex items-center justify-center transition-colors shadow-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 页码范围选择模态框 */}
      {showPageRangeModal && <PageRangeModal 
        onClose={() => setShowPageRangeModal(false)} 
        onConfirm={(start, end) => {
          // 提取指定页码范围的文本
          const pages = parsePagesFromFullText(pdfFullText)
          
          // 生成页码范围数组
          const pageNumbers: number[] = []
          for (let i = start; i <= end; i++) {
            pageNumbers.push(i)
          }
          
          // 提取这些页码的文本
          const extractedText = pages
            .filter(p => pageNumbers.includes(p.pageNumber))
            .map(p => `--- 第 ${p.pageNumber} 页 ---\n${p.text}`)
            .join('\n\n')
          
          // 添加为附件
          setAttachments([...attachments, {
            id: `range-${Date.now()}`,
            type: 'range',
            label: `${start}-${end}页`,
            pageNumbers,
            data: extractedText,
          }])
          
          setShowPageRangeModal(false)
        }} 
      />}

      {/* 文本选区预览弹窗 */}
      {previewText && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setPreviewText(null)}
        >
          <div
            className="relative bg-dark-800 border border-dark-500 rounded-lg shadow-2xl max-w-[60vw] max-h-[70vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 flex items-center justify-between px-4 py-2 bg-dark-700/80 border-b border-dark-500">
              <span className="text-xs text-dark-200 font-medium">选区预览</span>
              <button
                onClick={() => setPreviewText(null)}
                className="text-dark-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-3 text-sm text-dark-100 whitespace-pre-wrap leading-relaxed">
              {previewText}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ChatMessageItem({
  message,
  onPreviewImage,
}: {
  message: { id: string; role: string; content: string; timestamp: number; attachments?: { type: string; data: string; label: string }[] }
  onPreviewImage: (dataUrl: string) => void
}): JSX.Element {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const [copied, setCopied] = useState(false)
  const [isLongPress, setIsLongPress] = useState(false)
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)

  // 提取消息中的截图附件
  const screenshotAtts = message.attachments?.filter((a) => a.type === 'screenshot' && a.data) || []

  // 复制全文功能
  const handleCopy = async () => {
    try {
      // 清理内容中的特殊标记
      const cleanContent = message.content
        .replace(/【截图：[^】]*】\n*/g, '')
        .trim()
      await navigator.clipboard.writeText(cleanContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('复制失败:', err)
    }
  }

  // 长按处理
  const handleMouseDown = () => {
    longPressTimer.current = setTimeout(() => {
      setIsLongPress(true)
    }, 500)
  }

  const handleMouseUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    setIsLongPress(false)
  }

  const handleMouseLeave = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    setIsLongPress(false)
  }

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <span className="text-xs text-dark-300 bg-dark-700/50 px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    )
  }

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${
          isUser ? 'bg-dark-500' : 'bg-accent'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      <div className="flex flex-col gap-1 max-w-[85%]">
        <div
          className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
            isUser
              ? 'bg-accent text-white rounded-tr-sm'
              : 'bg-dark-700 text-dark-100 rounded-tl-sm'
          }`}
          style={{ minWidth: '0', overflowWrap: 'anywhere' }}
        >
          {/* 截图预览 */}
          {screenshotAtts.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {screenshotAtts.map((att, i) => (
                <div key={i} className="inline-flex flex-col items-start">
                  <img
                    src={att.data}
                    alt={att.label}
                    className="max-w-[200px] max-h-[150px] rounded-lg border border-white/20 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => onPreviewImage(att.data)}
                  />
                  <span className="text-[11px] opacity-60 mt-1">{att.label}</span>
                </div>
              ))}
            </div>
          )}
          {/* 文字内容：使用 Markdown 渲染，支持数学公式 */}
          <div className="break-words prose prose-invert prose-sm max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkMath]}
              rehypePlugins={[[rehypeKatex, { output: 'html', strict: false, throwOnError: false }]]}
              components={{
                p: ({ children }) => <p className="m-0 mb-2">{children}</p>,
                pre: ({ children }) => <pre className="bg-dark-800 p-2 rounded overflow-x-auto">{children}</pre>,
                code: ({ children }) => <code className="bg-dark-800 px-1 rounded text-sm">{children}</code>,
              }}
            >
              {(() => {
                let content = message.content.replace(/【截图：[^】]*】\n*/g, '').trim()
                // 转换 \[ ... \] 为 $$...$$
                content = content.replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
                // 转换 \( ... \) 为 $...$
                content = content.replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$')
                // 转换 \Gamma 等为实际字符
                content = content.replace(/\\Gamma/g, 'Γ')
                content = content.replace(/\\mu/g, 'μ')
                content = content.replace(/\\tag\{(\d+)\}/g, '\\quad ($1)')
                return content
              })()}
            </ReactMarkdown>
          </div>
          <div className={`text-[10px] mt-1.5 ${isUser ? 'text-blue-200' : 'text-dark-300'}`}>
            {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        </div>
        
        {/* AI 消息复制按钮 - 右下角，仅图标，长按显示文字 */}
        {!isUser && !isSystem && (
          <div className="flex justify-end">
            <button
              onClick={handleCopy}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              onTouchStart={handleMouseDown}
              onTouchEnd={handleMouseUp}
              className="flex items-center gap-1 text-[10px] text-dark-500 hover:text-dark-300 transition-all px-1.5 py-0.5 rounded"
              title="复制全部"
            >
              {copied ? (
                <CheckCheck className="w-3 h-3 text-green-400" />
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  {isLongPress && (
                    <span className="text-dark-400 animate-fade-in">复制全部</span>
                  )}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// 保存对话框组件
function SaveDialog({
  session,
  onClose,
}: {
  session: ChatSession
  onClose: () => void
}): JSX.Element {
  const {
    chatSessionFolders,
    updateChatSessionFolder,
    createChatFolder,
    selectedChatFolderId,
  } = useAppStore()

  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)

  const handleSaveToFolder = (folderId: string | null) => {
    updateChatSessionFolder(session.id, folderId)
    onClose()
  }

  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      const folderId = createChatFolder(newFolderName.trim())
      updateChatSessionFolder(session.id, folderId)
      setNewFolderName('')
      setShowNewFolderInput(false)
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
      <div className="bg-dark-800 border border-dark-500 rounded-lg shadow-xl w-80 max-w-[90vw]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-500">
          <h3 className="text-sm font-medium text-white">保存对话</h3>
          <button onClick={onClose} className="text-dark-300 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-2 max-h-80 overflow-y-auto">
          {/* 新建文件夹输入 */}
          {showNewFolderInput ? (
            <div className="px-3 py-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateFolder()
                    if (e.key === 'Escape') setShowNewFolderInput(false)
                  }}
                  placeholder="文件夹名称"
                  className="flex-1 bg-dark-700 border border-dark-500 rounded px-2 py-1.5 text-sm text-dark-100 outline-none focus:border-accent"
                  autoFocus
                />
                <button
                  onClick={handleCreateFolder}
                  className="px-3 py-1.5 bg-accent/20 text-accent rounded text-xs font-medium"
                >
                  创建
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowNewFolderInput(true)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-accent hover:bg-dark-700 transition-colors text-left mb-2"
            >
              <Plus className="w-4 h-4" />
              <span>新建文件夹</span>
            </button>
          )}

          {/* 分隔线 */}
          <div className="my-2 border-t border-dark-500" />

          {/* 根目录选项 */}
          <button
            onClick={() => handleSaveToFolder(null)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left ${
              session.folderId === null
                ? 'bg-accent/10 text-accent'
                : 'text-dark-100 hover:bg-dark-700 hover:text-white'
            }`}
          >
            <Folder className="w-4 h-4 text-dark-300" />
            <span>根目录（最近对话）</span>
            {session.folderId === null && <Check className="w-4 h-4 text-accent ml-auto" />}
          </button>

          {/* 文件夹列表 */}
          {chatSessionFolders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => handleSaveToFolder(folder.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left ${
                session.folderId === folder.id
                  ? 'bg-accent/10 text-accent'
                  : 'text-dark-100 hover:bg-dark-700 hover:text-white'
              }`}
            >
              {folder.icon === 'Star' ? (
                <Star className="w-4 h-4 text-yellow-400" />
              ) : folder.icon === 'FileText' ? (
                <FileText className="w-4 h-4 text-accent" />
              ) : (
                <Folder className="w-4 h-4 text-dark-300" />
              )}
              <span>{folder.name}</span>
              {session.folderId === folder.id && <Check className="w-4 h-4 text-accent ml-auto" />}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-dark-500">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-dark-200 hover:text-white transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

// 页码范围选择组件
function PageRangeModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void
  onConfirm: (startPage: number, endPage: number) => void
}): JSX.Element {
  const { tabs, activeTabId } = useAppStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const totalPages = activeTab?.totalPages || 1
  const currentPage = activeTab?.pageNumber || 1
  
  const [startPage, setStartPage] = useState<number>(Math.max(1, currentPage - 2))
  const [endPage, setEndPage] = useState<number>(Math.min(totalPages, currentPage + 2))

  const handleConfirm = () => {
    const realStart = Math.max(1, Math.min(startPage, endPage))
    const realEnd = Math.min(totalPages, Math.max(startPage, endPage))
    onConfirm(realStart, realEnd)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-dark-800 border border-dark-500 rounded-lg shadow-2xl w-80 max-w-[90vw]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-500">
          <h3 className="text-sm font-medium text-white">选择页码范围</h3>
          <button onClick={onClose} className="text-dark-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-dark-200 min-w-[50px]">从</label>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={startPage}
                onChange={(e) => setStartPage(Math.max(1, Math.min(totalPages, parseInt(e.target.value) || 1)))}
                className="flex-1 bg-dark-700 border border-dark-500 rounded px-3 py-2 text-sm text-dark-100 outline-none focus:border-accent"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-dark-200 min-w-[50px]">到</label>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={endPage}
                onChange={(e) => setEndPage(Math.max(1, Math.min(totalPages, parseInt(e.target.value) || totalPages)))}
                className="flex-1 bg-dark-700 border border-dark-500 rounded px-3 py-2 text-sm text-dark-100 outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="text-xs text-dark-400">
            共 {totalPages} 页 | 将提取第 {Math.max(1, Math.min(startPage, endPage))}-{Math.min(totalPages, Math.max(startPage, endPage))} 页的文本
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-dark-500">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-dark-200 hover:text-white transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-1.5 text-xs bg-accent hover:bg-accent/80 text-dark-900 font-medium rounded transition-colors"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}
