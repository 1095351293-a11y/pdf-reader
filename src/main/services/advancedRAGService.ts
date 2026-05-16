/**
 * 企业级 RAG 检索流水线 - Advanced RAG Service
 *
 * 流水线顺序（工业落地标准）：
 * 用户问题 → 1.问题改写（多Query扩召回）→ 2.混合检索（向量+BM25）→
 * 3.结果合并去重 → 4.Rerank重排序 → 5.上下文压缩降噪 → 6.送入大模型
 */

import { ChatOpenAI } from '@langchain/openai'
import { PromptTemplate } from '@langchain/core/prompts'
import { getDatabase } from '../db'
import { net } from 'electron'

// ========== 类型定义 ==========

export interface RAGConfig {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  embeddingModel?: string
}

export interface ChunkDocument {
  id: string
  pageContent: string
  metadata: {
    pdfId: string
    pageNumber: number
    chunkIndex: number
    section?: string
    sectionLevel?: number
    type?: string
    importance?: number
    keywords?: string[]
    embedding?: number[]
  }
}

export interface SearchResult {
  document: ChunkDocument
  score: number
  searchType: 'vector' | 'keyword'
}

// ========== 1. 问题改写（多Query扩召回）==========

const QUERY_EXPANSION_TEMPLATE = `你是一个专业的搜索优化助手。请将用户的原始问题改写成多个不同角度的查询，以提高文档召回率。

原始问题: {query}

请生成 {count} 个不同角度的查询（保持原意，但使用不同的关键词和表达方式）：

要求：
1. 每个查询应该关注问题的不同方面
2. 使用同义词或相关术语替换关键词
3. 可以改变句式结构（疑问句、陈述句等）
4. 确保所有查询都与原始问题相关

请直接返回查询列表，每行一个，不要编号或其他说明：`

/**
 * 多Query扩召回 - 生成多个相关查询
 */
export async function generateMultiQueries(
  originalQuery: string,
  config: RAGConfig,
  count: number = 3
): Promise<string[]> {
  const llm = createLLM(config)

  const prompt = PromptTemplate.fromTemplate(QUERY_EXPANSION_TEMPLATE)
  const chain = prompt.pipe(llm)

  try {
    const result = await chain.invoke({
      query: originalQuery,
      count: count.toString()
    })

    // 解析生成的查询
    const generatedQueries = result.content
      .toString()
      .split('\n')
      .map(q => q.trim())
      .filter(q => q.length > 0 && !q.startsWith('-') && !q.match(/^\d+\./))
      .slice(0, count)

    // 确保包含原始查询
    const allQueries = [originalQuery, ...generatedQueries]
    console.log('[AdvancedRAG] 多Query扩召回:', allQueries)

    return [...new Set(allQueries)] // 去重
  } catch (err) {
    console.error('[AdvancedRAG] 查询扩展失败:', err)
    return [originalQuery]
  }
}

// ========== 2. 混合检索（向量 + BM25关键词）==========

/**
 * 向量检索（支持父子双块结构）
 * 在子块中检索，返回父块内容
 */
export async function vectorSearch(
  query: string,
  pdfId: string,
  config: RAGConfig,
  topK: number = 10
): Promise<SearchResult[]> {
  const db = getDatabase()

  // 获取查询向量
  const queryEmbedding = await getEmbedding(query, config)

  // 1. 在子块中检索（child 和 both 角色）
  const childRows = db.prepare(`
    SELECT id, page_number, chunk_index, content, embedding,
           section, section_level, type, keywords, importance,
           parent_id, chunk_role
    FROM pdf_chunks
    WHERE pdf_id = ? 
      AND embedding IS NOT NULL
      AND chunk_role IN ('child', 'both')
  `).all(pdfId) as any[]

  if (childRows.length === 0) return []

  // 2. 计算子块相似度
  const scoredChildren = childRows.map(row => {
    let score = 0
    if (row.embedding) {
      try {
        const emb = JSON.parse(row.embedding)
        if (Array.isArray(emb) && emb.length === queryEmbedding.length) {
          score = cosineSimilarity(queryEmbedding, emb)
        }
      } catch {
        // ignore
      }
    }
    return {
      ...row,
      score,
      parentId: row.parent_id
    }
  })

  // 3. 按相似度排序
  scoredChildren.sort((a, b) => b.score - b.score)

  // 4. 获取匹配的父块ID（去重）
  const parentIds = [...new Set(scoredChildren.map(c => c.parentId).filter(Boolean))]

  if (parentIds.length === 0) return []

  // 5. 获取父块内容
  const parentRows = db.prepare(`
    SELECT id, page_number, chunk_index, content,
           section, section_level, type, keywords, importance,
           child_ids, chunk_role
    FROM pdf_chunks
    WHERE id IN (${parentIds.map(() => '?').join(',')})
  `).all(...parentIds) as any[]

  // 6. 构建结果：父块内容 + 子块匹配分数
  const results: SearchResult[] = parentRows.map(parent => {
    // 找到该父块下匹配度最高的子块分数
    const childScores = scoredChildren
      .filter(c => c.parentId === parent.id)
      .map(c => c.score)
    
    const maxChildScore = Math.max(...childScores, 0)
    
    return {
      document: rowToDocument(parent, pdfId),
      score: maxChildScore,
      searchType: 'vector' as const
    }
  })

  // 7. 按分数排序并返回
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, topK)
}

/**
 * BM25 关键词检索（支持父子双块结构）
 * 在子块中检索，返回父块内容
 */
export function bm25Search(
  query: string,
  pdfId: string,
  topK: number = 10
): SearchResult[] {
  const db = getDatabase()

  // 1. 在子块中检索（child 和 both 角色）
  const childRows = db.prepare(`
    SELECT id, page_number, chunk_index, content,
           section, section_level, type, keywords, importance,
           parent_id, chunk_role
    FROM pdf_chunks
    WHERE pdf_id = ?
      AND chunk_role IN ('child', 'both')
  `).all(pdfId) as any[]

  if (childRows.length === 0) return []

  // 2. 计算子块 BM25 分数
  const scoredChildren = childRows.map(row => {
    const score = calculateBM25(query, row.content, childRows.length, childRows.length)
    return {
      ...row,
      score,
      parentId: row.parent_id
    }
  })

  // 3. 按分数排序
  scoredChildren.sort((a, b) => b.score - a.score)

  // 4. 获取匹配的父块ID（去重）
  const parentIds = [...new Set(scoredChildren.map(c => c.parentId).filter(Boolean))]

  if (parentIds.length === 0) return []

  // 5. 获取父块内容
  const parentRows = db.prepare(`
    SELECT id, page_number, chunk_index, content,
           section, section_level, type, keywords, importance,
           child_ids, chunk_role
    FROM pdf_chunks
    WHERE id IN (${parentIds.map(() => '?').join(',')})
  `).all(...parentIds) as any[]

  // 6. 构建结果：父块内容 + 子块匹配分数
  const results: SearchResult[] = parentRows.map(parent => {
    // 找到该父块下匹配度最高的子块分数
    const childScores = scoredChildren
      .filter(c => c.parentId === parent.id)
      .map(c => c.score)
    
    const maxChildScore = Math.max(...childScores, 0)
    
    return {
      document: rowToDocument(parent, pdfId),
      score: maxChildScore,
      searchType: 'keyword' as const
    }
  })

  // 7. 按分数排序并返回
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, topK)
}

/**
 * 混合检索 - 融合向量检索和 BM25 检索
 * 默认权重：向量 0.9，BM25 0.1（针对跨语言场景优化）
 */
export async function hybridSearch(
  query: string,
  pdfId: string,
  config: RAGConfig,
  topK: number = 10,
  vectorWeight: number = 0.9,
  keywordWeight: number = 0.1
): Promise<SearchResult[]> {
  // 并行执行两种检索
  const [vectorResults, keywordResults] = await Promise.all([
    vectorSearch(query, pdfId, config, topK * 2),
    bm25Search(query, pdfId, topK * 2)
  ])

  // 归一化分数
  const normalizedVector = normalizeScores(vectorResults)
  const normalizedKeyword = normalizeScores(keywordResults)

  // 融合分数
  const scoreMap = new Map<string, SearchResult & { fusedScore: number }>()

  // 添加向量检索结果
  for (const result of normalizedVector) {
    scoreMap.set(result.document.id, {
      ...result,
      fusedScore: result.score * vectorWeight
    })
  }

  // 添加关键词检索结果
  for (const result of normalizedKeyword) {
    const existing = scoreMap.get(result.document.id)
    if (existing) {
      existing.fusedScore += result.score * keywordWeight
      existing.searchType = 'vector' // 标记为混合
    } else {
      scoreMap.set(result.document.id, {
        ...result,
        fusedScore: result.score * keywordWeight
      })
    }
  }

  // 按融合分数排序
  const fusedResults = Array.from(scoreMap.values())
    .map(r => ({ ...r, score: r.fusedScore }))
    .sort((a, b) => b.score - a.score)

  return fusedResults.slice(0, topK)
}

// ========== 3. 结果合并去重 ==========

/**
 * 合并多Query检索结果并去重
 */
export function mergeAndDeduplicate(
  resultsPerQuery: SearchResult[][],
  topK: number = 10
): SearchResult[] {
  const seen = new Set<string>()
  const merged: SearchResult[] = []

  // 按分数排序后合并
  for (const results of resultsPerQuery) {
    for (const result of results) {
      if (!seen.has(result.document.id)) {
        seen.add(result.document.id)
        merged.push(result)
      }
    }
  }

  // 重新按分数排序
  merged.sort((a, b) => b.score - a.score)

  return merged.slice(0, topK)
}

// ========== 4. Rerank 重排序（BGE-Reranker）==========

export interface RerankerConfig {
  model: string
  apiKey: string
  baseUrl: string
}

const DEFAULT_RERANKER_CONFIG: RerankerConfig = {
  model: '',
  apiKey: '',
  baseUrl: ''
}

/**
 * 调用 BGE-Reranker API 进行重排序
 */
export async function rerankResults(
  query: string,
  results: SearchResult[],
  config?: Partial<RerankerConfig>
): Promise<SearchResult[]> {
  if (results.length === 0) return results

  const rerankerConfig = { ...DEFAULT_RERANKER_CONFIG, ...config }

  // 如果没有配置 API Key，直接返回原结果
  if (!rerankerConfig.apiKey) {
    console.log('[AdvancedRAG] Rerank 阶段（未配置 API Key，跳过）')
    return results
  }

  console.log('[AdvancedRAG] Rerank 阶段（BGE-Reranker-v2-m3）')

  const url = `${rerankerConfig.baseUrl.replace(/\/+$/, '')}/rerank`

  try {
    const response = await net.fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${rerankerConfig.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: rerankerConfig.model,
        query: query,
        documents: results.map(r => r.document.pageContent),
        top_n: results.length,
        return_documents: false
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rerank API 错误: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    if (!data.results || !Array.isArray(data.results)) {
      throw new Error('Rerank API 返回格式错误')
    }

    // 根据重排序结果重新排序
    const rerankedResults = data.results
      .map((item: any) => ({
        result: results[item.index],
        relevanceScore: item.relevance_score
      }))
      .sort((a: any, b: any) => b.relevanceScore - a.relevanceScore)
      .map((item: any) => ({
        ...item.result,
        score: item.relevanceScore,
        searchType: 'reranked' as const
      }))

    console.log(`[AdvancedRAG] Rerank 完成: ${rerankedResults.length} 个结果`)
    return rerankedResults

  } catch (error: any) {
    console.error('[AdvancedRAG] Rerank 失败:', error.message)
    // 降级：返回原始结果
    return results
  }
}

// ========== 5. 上下文压缩降噪 ==========

const CONTEXT_COMPRESSION_TEMPLATE = `请分析以下文档片段与用户问题的相关性，只保留高度相关的内容。

用户问题: {query}

文档片段:
{content}

请判断这个片段是否与问题相关：
- 如果相关，返回原文（不要修改）
- 如果不相关，返回空字符串
- 如果部分相关，提取相关句子

只返回处理后的内容，不要解释：`

/**
 * 上下文压缩 - 过滤无关内容
 */
export async function compressContext(
  query: string,
  results: SearchResult[],
  config: RAGConfig
): Promise<SearchResult[]> {
  const llm = createLLM(config)
  const prompt = PromptTemplate.fromTemplate(CONTEXT_COMPRESSION_TEMPLATE)
  const chain = prompt.pipe(llm)

  const compressed: SearchResult[] = []

  for (const result of results) {
    try {
      const compressedContent = await chain.invoke({
        query,
        content: result.document.pageContent
      })

      const trimmed = compressedContent.content.toString().trim()

      if (trimmed.length > 0) {
        compressed.push({
          ...result,
          document: {
            ...result.document,
            pageContent: trimmed
          }
        })
      }
    } catch (err) {
      console.warn('[AdvancedRAG] 压缩失败，保留原文:', err)
      compressed.push(result)
    }
  }

  console.log(`[AdvancedRAG] 上下文压缩: ${results.length} → ${compressed.length}`)
  return compressed
}

// ========== 6. 完整检索流水线 ==========

export interface AdvancedRAGResult {
  chunks: Array<{
    id: string
    pageNumber: number
    chunkIndex: number
    content: string
    score: number
    section?: string
    type?: string
    searchType: string
  }>
  expandedQueries: string[]
  totalRetrieved: number
  finalCount: number
}

/**
 * 企业级 RAG 检索流水线（主入口）
 */
export async function advancedRAGSearch(
  pdfId: string,
  query: string,
  config: RAGConfig,
  options: {
    topK?: number
    expandQueries?: boolean
    enableCompression?: boolean
    enableRerank?: boolean
    vectorWeight?: number
    keywordWeight?: number
    rerankerConfig?: Partial<RerankerConfig>
  } = {}
): Promise<AdvancedRAGResult> {
  const {
    topK = 5,
    expandQueries = true,
    enableCompression = true,
    enableRerank = true,
    vectorWeight = 0.6,
    keywordWeight = 0.4,
    rerankerConfig
  } = options

  console.log('[AdvancedRAG] ========== 开始企业级检索 ==========')
  console.log('[AdvancedRAG] 原始查询:', query)

  // 1. 问题改写（多Query扩召回）
  let queries: string[]
  if (expandQueries) {
    queries = await generateMultiQueries(query, config, 3)
  } else {
    queries = [query]
  }
  console.log('[AdvancedRAG] 扩展查询:', queries)

  // 2. 混合检索（每个扩展查询都检索）
  const searchResultsPerQuery: SearchResult[][] = []
  for (const q of queries) {
    const results = await hybridSearch(q, pdfId, config, topK * 2, vectorWeight, keywordWeight)
    searchResultsPerQuery.push(results)
  }

  // 3. 结果合并去重
  const mergedResults = mergeAndDeduplicate(searchResultsPerQuery, topK * 2)
  console.log('[AdvancedRAG] 合并去重后:', mergedResults.length)

  // 4. Rerank 重排序
  let rerankedResults = mergedResults
  if (enableRerank) {
    rerankedResults = await rerankResults(query, mergedResults, rerankerConfig)
  }

  // 5. 上下文压缩降噪
  let finalResults = rerankedResults
  if (enableCompression) {
    finalResults = await compressContext(query, rerankedResults, config)
  }

  // 取 TopK
  finalResults = finalResults.slice(0, topK)

  console.log('[AdvancedRAG] 最终结果:', finalResults.length)
  console.log('[AdvancedRAG] ========== 检索完成 ==========')

  return {
    chunks: finalResults.map(r => ({
      id: r.document.id,
      pageNumber: r.document.metadata.pageNumber,
      chunkIndex: r.document.metadata.chunkIndex,
      content: r.document.pageContent,
      score: r.score,
      section: r.document.metadata.section,
      type: r.document.metadata.type,
      searchType: r.searchType
    })),
    expandedQueries: queries,
    totalRetrieved: mergedResults.length,
    finalCount: finalResults.length
  }
}

// ========== 工具函数 ==========

function createLLM(config: RAGConfig): ChatOpenAI {
  return new ChatOpenAI({
    apiKey: config.apiKey,
    model: config.model,
    temperature: 0,
    configuration: {
      baseURL: config.baseUrl
    }
  })
}

async function getEmbedding(text: string, config: RAGConfig): Promise<number[]> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/embeddings`

  const response = await net.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.embeddingModel || config.model,
      input: text
    })
  })

  if (!response.ok) {
    throw new Error(`Embedding API 错误: ${response.status}`)
  }

  const data = await response.json()
  return data.data?.[0]?.embedding
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/**
 * 简化的 BM25 实现
 */
function calculateBM25(
  query: string,
  document: string,
  totalDocs: number,
  avgDocLength: number,
  k1: number = 1.5,
  b: number = 0.75
): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1)
  const docTerms = document.toLowerCase().split(/\s+/)
  const docLength = docTerms.length

  if (queryTerms.length === 0 || docLength === 0) return 0

  const termFreq: Record<string, number> = {}
  docTerms.forEach(t => {
    termFreq[t] = (termFreq[t] || 0) + 1
  })

  let score = 0
  for (const term of queryTerms) {
    const tf = termFreq[term] || 0
    if (tf === 0) continue

    const idf = Math.log(1 + (totalDocs - 1 + 0.5) / (1 + 0.5))
    const tfComponent = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLength / avgDocLength)))

    score += idf * tfComponent
  }

  return score
}

function normalizeScores(results: SearchResult[]): SearchResult[] {
  if (results.length === 0) return results

  const scores = results.map(r => r.score)
  const maxScore = Math.max(...scores)
  const minScore = Math.min(...scores)
  const range = maxScore - minScore

  if (range === 0) return results.map(r => ({ ...r, score: 1 }))

  return results.map(r => ({
    ...r,
    score: (r.score - minScore) / range
  }))
}

function rowToDocument(row: any, pdfId: string): ChunkDocument {
  return {
    id: row.id,
    pageContent: row.content,
    metadata: {
      pdfId,
      pageNumber: row.page_number,
      chunkIndex: row.chunk_index,
      section: row.section,
      sectionLevel: row.section_level,
      type: row.type,
      importance: row.importance,
      keywords: row.keywords ? JSON.parse(row.keywords) : undefined
    }
  }
}
