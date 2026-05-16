import { ipcMain, net } from 'electron'
import { getDatabase } from '../db'
import * as path from 'path'
import * as fs from 'fs'
import { LayoutElement } from './layoutService'
import { advancedRAGSearch } from './advancedRAGService'
import { createSemanticChunksFromElements, estimateTokens } from './parentChildChunkService'
import { runReActAgentWithHistory } from './reactAgentService'

// ========== 路径工具函数 ==========

/** 标准化路径 */
function normalizePath(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, '/').toLowerCase()
}

// ========== Embedding API 调用 ==========

/** 构建 embedding API URL */
function buildEmbeddingUrl(provider: string, baseUrl: string): string {
  const base = (baseUrl || '').replace(/\/+$/, '')
  if (!base) throw new Error('未填写 API 地址')
  // OpenAI 兼容接口都有 /embeddings 端点
  if (base.endsWith('/embeddings')) return base
  return `${base}/embeddings`
}

/** 调用 embedding API 生成向量 */
async function getEmbedding(
  text: string,
  config: { provider: string; baseUrl: string; apiKey: string; model: string; embeddingModel?: string }
): Promise<number[]> {
  // Anthropic 不支持 embedding API，回退到关键词匹配
  if (config.provider === 'anthropic') {
    throw new Error('Anthropic 不支持 Embedding API，请配置其他服务商用于 RAG')
  }

  // ✅ 强制使用 embeddingModel 字段
  const model = config.embeddingModel

  if (!model) {
    throw new Error('embeddingModel 必须存在，请检查模型配置')
  }

  console.log('[RAG] 调用 embedding API，model:', model)

  const url = buildEmbeddingUrl(config.provider, config.baseUrl)
  const response = await net.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: text,
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`Embedding API 错误 HTTP ${response.status}: ${errText.substring(0, 200)}`)
  }

  const data = await response.json()
  console.log('🔥 embedding raw response:', data)
  const embedding = data.data?.[0]?.embedding
  if (!embedding || !Array.isArray(embedding)) {
    throw new Error('Embedding API 返回格式异常')
  }
  return embedding
}

/** 批量获取 embedding（每次最多处理 batchLimit 条） */
async function getEmbeddingsBatch(
  texts: string[],
  config: { provider: string; baseUrl: string; apiKey: string; model: string; embeddingModel?: string },
  batchLimit = 20
): Promise<number[][]> {
  console.log('[RAG] getEmbeddingsBatch 开始，texts数量:', texts.length, 'model:', config.model)
  const results: number[][] = []

  for (let i = 0; i < texts.length; i += batchLimit) {
    const batch = texts.slice(i, i + batchLimit)
    console.log('[RAG] 处理 batch:', i, '大小:', batch.length)

    if (batch.length === 1) {
      // 单条直接调用
      const emb = await getEmbedding(batch[0], config)
      results.push(emb)
    } else {
      // 批量调用
      try {
        const url = buildEmbeddingUrl(config.provider, config.baseUrl)
        const response = await net.fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.embeddingModel || '', // ✅ 必须用 embeddingModel，不能用 model
            input: batch,
          }),
        })

        if (!response.ok) {
          const errText = await response.text().catch(() => '')
          throw new Error(`Embedding API 错误 HTTP ${response.status}: ${errText.substring(0, 200)}`)
        }

        const data = await response.json()
        console.log('[RAG] 批量 embedding 响应:', data)
        if (data.data && Array.isArray(data.data)) {
          // ✅ 关键修复：使用 index 对齐，而不是直接 push
          const batchEmbeddings: (number[] | undefined)[] = new Array(batch.length)

          for (const item of data.data) {
            console.log('[RAG] item.index:', item.index, 'embedding.length:', item.embedding?.length)
            if (item.embedding && Array.isArray(item.embedding)) {
              batchEmbeddings[item.index] = item.embedding
            }
          }

          // 检查是否有缺失
          if (batchEmbeddings.includes(undefined)) {
            throw new Error('embedding 缺失，index 对齐失败')
          }

          results.push(...(batchEmbeddings as number[][]))
        } else {
          throw new Error('Embedding 返回格式异常')
        }
      } catch {
        // 批量失败，回退到逐条调用
        for (const text of batch) {
          const emb = await getEmbedding(text, config)
          results.push(emb)
        }
      }
    }
  }

  console.log('[RAG] getEmbeddingsBatch 完成，results数量:', results.length, '预期:', texts.length)
  if (results.length !== texts.length) {
    console.error('[RAG] 结果数量不匹配!')
  }
  return results
}

// ========== RAG 服务注册 ==========

export function registerRAGService(): void {
  const db = getDatabase()

  // ========== 索引 PDF：智能分块 + 生成 embedding ==========
  ipcMain.handle(
    'rag:indexPdf',
    async (
      _,
      params: {
        pdfId: string
        filePath: string
        elements: LayoutElement[]  // 结构化元素数组
        config: { provider: string; baseUrl: string; apiKey: string; model: string; embeddingModel?: string }
      }
    ) => {
      try {
        const { pdfId, filePath, elements, config } = params

        // 检查是否已索引
        const existingChunks = db.prepare(
          'SELECT COUNT(*) as cnt FROM pdf_chunks WHERE pdf_id = ? AND file_path = ?'
        ).get(pdfId, filePath) as { cnt: number }

        // 如果已有索引，跳过重复索引
        if ((existingChunks as any).cnt > 0) {
          return { success: true, message: '已有索引，跳过', chunkCount: (existingChunks as any).cnt }
        }

        // 1. 智能分块（基于结构化元素）
        const chunks = await createSemanticChunksFromElements(pdfId, elements)
        if (!chunks || chunks.length === 0) {
          return { success: true, message: 'PDF 无可索引文本', chunkCount: 0 }
        }

        // 2. 生成 embedding
        const texts = chunks.map((c) => c.content)
        let embeddings: number[][]

        try {
          embeddings = await getEmbeddingsBatch(texts, config)
        } catch (err: any) {
          console.error('[RAG] Embedding 生成失败:', err)
          return {
            success: false,
            message: `Embedding 失败: ${err.message || '请检查向量模型配置'}`,
            chunkCount: 0,
          }
        }

        // 校验 embedding 结果
        if (!embeddings || embeddings.length !== chunks.length) {
          console.error('[RAG] Embedding 结果异常:', embeddings?.length, '!==', chunks.length)
          return {
            success: false,
            message: 'Embedding 结果异常，请重试',
            chunkCount: 0,
          }
        }

        // 3. 写入数据库
        console.log('[RAG] chunks:', chunks.length, 'embeddings:', embeddings.length)

        for (let i = 0; i < embeddings.length; i++) {
          if (!embeddings[i] || embeddings[i].length === 0) {
            console.error('❌ embedding 丢失 at i=', i)
            return {
              success: false,
              message: `embedding 缺失 at index ${i}`,
              chunkCount: 0,
            }
          }
        }

        // 先删除旧数据
        db.prepare('DELETE FROM pdf_chunks WHERE pdf_id = ?').run(pdfId)
        console.log('[RAG] 已删除旧索引数据')

        const insertStmt = db.prepare(`
          INSERT INTO pdf_chunks (id, pdf_id, file_path, page_number, chunk_index, content, embedding, element_type, section, bbox, created_at)
          VALUES (@id, @pdfId, @filePath, @pageNumber, @chunkIndex, @content, @embedding, @elementType, @section, @bbox, @createdAt)
        `)

        const insertMany = db.transaction(() => {
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i]
            insertStmt.run({
              id: chunk.id,
              pdfId,
              filePath,
              pageNumber: chunk.pageNumber,
              chunkIndex: chunk.chunkIndex,
              content: chunk.content,
              embedding: JSON.stringify(embeddings[i]),
              elementType: chunk.elementType,
              section: chunk.section || '',
              bbox: chunk.bbox || '',
              createdAt: Date.now(),
            })
          }
        })

        insertMany()

        // 自检
        const row = db.prepare(`
          SELECT COUNT(*) as total,
                 SUM(CASE WHEN embedding IS NOT NULL AND LENGTH(embedding) > 10 THEN 1 ELSE 0 END) as embedded
          FROM pdf_chunks WHERE pdf_id = ?
        `).get(pdfId) as { total: number; embedded: number }

        console.log('[RAG] index self-check:', row)
        if (row.embedded === 0) {
          throw new Error('索引失败：embedding 未写入数据库')
        }

        console.log(`[RAG] 索引成功: ${chunks.length} 个分块已写入数据库`)
        return { success: true, message: `索引完成，共 ${chunks.length} 个分块`, chunkCount: chunks.length }
      } catch (err: any) {
        return { success: false, message: `索引失败: ${err.message || '未知错误'}` }
      }
    }
  )

  // ========== 检索：企业级 RAG 标准检索流水线 ==========
  ipcMain.handle(
    'rag:search',
    async (
      _,
      params: {
        pdfId: string
        query: string
        config: { provider: string; baseUrl: string; apiKey: string; model: string; embeddingModel?: string }
        topK?: number
        rerankerConfig?: { model: string; apiKey: string; baseUrl: string }
      }
    ) => {
      try {
        const { pdfId, query, config, topK = 5, rerankerConfig } = params

        // 检查索引状态
        const indexStatus = db.prepare(
          'SELECT COUNT(*) as total FROM pdf_chunks WHERE pdf_id = ?'
        ).get(pdfId) as { total: number }

        if (indexStatus.total === 0) {
          return { success: false, message: '该 PDF 尚未建立索引，请先打开 PDF 等待自动索引', chunks: [] }
        }

        // 🚀 使用企业级 RAG 检索流水线
        console.log('[RAG] 使用企业级 Advanced RAG 检索流水线')

        const result = await advancedRAGSearch(pdfId, query, config, {
          topK,
          expandQueries: true,
          enableCompression: true,
          enableRerank: !!rerankerConfig,
          vectorWeight: 0.9,
          keywordWeight: 0.1,
          rerankerConfig
        })

        // 转换为原有格式兼容
        const chunks = result.chunks.map(chunk => ({
          id: chunk.id,
          pageNumber: chunk.pageNumber,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          score: chunk.score,
          section: chunk.section,
          sectionLevel: 0,
          type: chunk.type || 'paragraph',
          keywords: [],
          importance: 0.5,
          tokens: 0,
          prevId: null,
          nextId: null,
          parentId: null,
        }))

        console.log(`[RAG] Advanced RAG 检索完成: 扩展查询 ${result.expandedQueries.length} 个, 最终召回 ${result.finalCount} 个 chunks`)

        return {
          success: true,
          chunks,
          expandedQueries: result.expandedQueries,
          totalRetrieved: result.totalRetrieved,
          finalCount: result.finalCount
        }
      } catch (err: any) {
        console.error('[RAG] 检索失败:', err)
        return { success: false, message: `检索失败: ${err.message || '未知错误'}`, chunks: [] }
      }
    }
  )

  // ========== 删除 PDF 索引 ==========
  ipcMain.handle('rag:deleteIndex', async (_, pdfId: string) => {
    try {
      db.prepare('DELETE FROM pdf_chunks WHERE pdf_id = ?').run(pdfId)
      return { success: true }
    } catch (err: any) {
      return { success: false, message: err.message || '删除失败' }
    }
  })

  // ========== 使用新版 PDF 处理流程建立语义化索引 ==========
  ipcMain.handle('rag:indexPdfWithOpenDataLoader', async (
    _,
    params: {
      pdfId: string
      filePath: string
      config: { provider: string; baseUrl: string; apiKey: string; model: string; embeddingModel?: string }
    }
  ) => {
    try {
      const { pdfId, filePath, config } = params

      console.log(`[RAG] 使用新版 PDF 处理流程: ${filePath}`)

      // 1. 使用新版 processPDF 处理（获取结构化元素）
      const { processPDF } = await import('./pdfProcessor')
      const processResult = await processPDF(filePath)
      
      console.log(`[RAG] PDF 处理完成: ${processResult.elements.length} 个元素`)
      console.log(`[RAG] 是否扫描件: ${processResult.isScanned}`)

      if (processResult.elements.length === 0) {
        return { success: false, message: 'PDF 无内容', chunkCount: 0 }
      }

      // 2. 🧠 智能分块（基于结构化元素）
      const semanticChunks = await createSemanticChunksFromElements(pdfId, processResult.elements)
      if (!semanticChunks || semanticChunks.length === 0) {
        return { success: true, message: 'PDF 无可索引文本', chunkCount: 0 }
      }

      console.log(`[RAG] 智能分块完成: ${semanticChunks.length} 个 chunks`)
      console.log(`[RAG] 类型分布:`, semanticChunks.reduce((acc, c) => {
        acc[c.elementType] = (acc[c.elementType] || 0) + 1
        return acc
      }, {} as Record<string, number>))

      // 3. 删除旧索引
      db.prepare('DELETE FROM pdf_chunks WHERE pdf_id = ?').run(pdfId)

      // 4. 生成 embedding
      const texts = semanticChunks.map((c) => c.content)
      let embeddings: number[][]

      try {
        embeddings = await getEmbeddingsBatch(texts, config)
      } catch (err: any) {
        console.error('[RAG] Embedding 生成失败:', err)
        return {
          success: false,
          message: `Embedding 失败: ${err.message || '请检查向量模型配置'}`,
          chunkCount: 0,
        }
      }

      // 5. 校验 embedding 结果
      if (!embeddings || embeddings.length !== semanticChunks.length) {
        console.error('[RAG] Embedding 结果异常:', embeddings?.length, '!==', semanticChunks.length)
        return {
          success: false,
          message: 'Embedding 结果异常，请重试',
          chunkCount: 0,
        }
      }

      // 6. 📝 写入数据库（包含父子关系字段）
      const insertStmt = db.prepare(`
        INSERT INTO pdf_chunks (
          id, pdf_id, file_path, page_number, chunk_index, content, embedding, created_at,
          element_type, section, bbox, tokens,
          parent_id, child_ids, chunk_role, group_key
        ) VALUES (
          @id, @pdfId, @filePath, @pageNumber, @chunkIndex, @content, @embedding, @createdAt,
          @elementType, @section, @bbox, @tokens,
          @parentId, @childIds, @chunkRole, @groupKey
        )
      `)

      const insertMany = db.transaction(() => {
        for (let i = 0; i < semanticChunks.length; i++) {
          const chunk = semanticChunks[i]
          insertStmt.run({
            id: chunk.id,
            pdfId: chunk.pdfId,
            filePath: normalizePath(filePath),
            pageNumber: chunk.pageNumber,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            embedding: JSON.stringify(embeddings[i]),
            createdAt: Date.now(),
            elementType: chunk.elementType,
            section: chunk.section || '',
            bbox: chunk.bbox || '',
            tokens: chunk.tokens,
            // 父子关系字段
            parentId: chunk.parentId || null,
            childIds: chunk.childIds || null,
            chunkRole: chunk.chunkRole || 'child',
            groupKey: chunk.groupKey || null,
          })
        }
      })

      insertMany()

      // 7. 自检
      const row = db.prepare(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN embedding IS NOT NULL AND LENGTH(embedding) > 10 THEN 1 ELSE 0 END) as embedded,
               SUM(CASE WHEN type = 'heading' THEN 1 ELSE 0 END) as headings,
               SUM(CASE WHEN type = 'paragraph' THEN 1 ELSE 0 END) as paragraphs
        FROM pdf_chunks WHERE pdf_id = ?
      `).get(pdfId) as { total: number; embedded: number; headings: number; paragraphs: number }

      console.log('[RAG] index self-check:', row)
      if (row.embedded === 0) {
        throw new Error('索引失败：embedding 未写入数据库')
      }

      console.log(`[RAG] 语义化索引成功: ${semanticChunks.length} 个分块已写入数据库`)
      return {
        success: true,
        message: `索引完成，共 ${semanticChunks.length} 个语义化分块（标题:${row.headings}, 段落:${row.paragraphs}）`,
        chunkCount: semanticChunks.length
      }
    } catch (err: any) {
      console.error('[RAG] 索引失败:', err)
      return { success: false, message: `索引失败: ${err.message || '未知错误'}`, chunkCount: 0 }
    }
  })

  // ========== 辅助函数：将文本分割成页面 ==========
  function splitTextToPages(text: string): { pageNumber: number; text: string }[] {
    const pages: { pageNumber: number; text: string }[] = []

    // 尝试按常见的分页标识分割
    // 1. 先尝试按 "--- 第 X 页 ---" 或类似格式
    const pageRegex = /(?:^|\n)(?:---+\s*第?\s*(\d+)\s*页?\s*---+|Page\s+(\d+)|\[\s*(\d+)\s*\])/gi
    const matches = [...text.matchAll(pageRegex)]

    if (matches.length > 1) {
      // 找到了分页标识
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index || 0
        const end = i < matches.length - 1 ? matches[i + 1].index : text.length
        const pageText = text.substring(start, end).trim()
        const pageNum = parseInt(matches[i][1] || matches[i][2] || matches[i][3] || '1')
        if (pageText) {
          pages.push({ pageNumber: pageNum, text: pageText })
        }
      }
    } else {
      // 没有分页标识，按字符数大致分割（每页约 3000 字符）
      const charsPerPage = 3000
      const totalChars = text.length
      const estimatedPages = Math.ceil(totalChars / charsPerPage)

      for (let i = 0; i < estimatedPages; i++) {
        const start = i * charsPerPage
        const end = Math.min((i + 1) * charsPerPage, totalChars)
        const pageText = text.substring(start, end).trim()
        if (pageText) {
          pages.push({ pageNumber: i + 1, text: pageText })
        }
      }
    }

    // 如果分割失败，把整个文本作为一页
    if (pages.length === 0) {
      pages.push({ pageNumber: 1, text: text.trim() })
    }

    return pages
  }

  // ========== 获取前 N 个 chunk（摘要模式用） ==========
  ipcMain.handle('rag:getTopChunks', async (_, pdfId: string, limit: number = 10) => {
    try {
      const rows = db.prepare(
        'SELECT id, page_number, chunk_index, content, type, section, importance FROM pdf_chunks WHERE pdf_id = ? ORDER BY page_number, chunk_index LIMIT ?'
      ).all(pdfId, limit) as any[]

      const chunks = rows.map((row) => ({
        id: row.id,
        pageNumber: row.page_number,
        chunkIndex: row.chunk_index,
        content: row.content,
        type: row.type,
        section: row.section,
        importance: row.importance,
      }))

      return { success: true, chunks }
    } catch (err: any) {
      return { success: false, message: err.message || '获取失败', chunks: [] }
    }
  })

  // ========== 检查索引状态 ==========
  ipcMain.handle('rag:getIndexStatus', async (_, pdfId: string) => {
    const row = db.prepare(
      'SELECT COUNT(*) as total, SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) as embedded FROM pdf_chunks WHERE pdf_id = ?'
    ).get(pdfId) as any
    return {
      hasIndex: row.total > 0,
      totalChunks: row.total,
      embeddedChunks: row.embedded,
    }
  })

  // ========== 调试：执行 SQL 查询 ==========
  ipcMain.handle('rag:debug', async (_, pdfId: string) => {
    const total = db.prepare('SELECT COUNT(*) AS c FROM pdf_chunks WHERE pdf_id = ?').get(pdfId) as { c: number }
    const embedded = db.prepare('SELECT COUNT(*) AS c FROM pdf_chunks WHERE pdf_id = ? AND embedding IS NOT NULL').get(pdfId) as { c: number }
    console.log('[RAG Debug] SQL 结果:', { pdfId, total: total.c, embedded: embedded.c })
    return { total: total.c, embedded: embedded.c }
  })

  // ========== 直接从 PDF 解析目录（使用 OpenDataLoader 原始数据） ==========
  ipcMain.handle('rag:parseTOC', async (_, filePath: string) => {
    try {
      console.log(`[RAG ParseTOC] 直接解析 PDF 目录: ${filePath}`)

      // 1. 使用 OpenDataLoader 解析 PDF
      const { convert } = await import('@opendataloader/pdf')
      await convert([filePath], {
        format: 'json',
      })

      // 2. 读取生成的 JSON 文件
      const jsonFilePath = filePath.replace(/\.pdf$/i, '.json')
      if (!fs.existsSync(jsonFilePath)) {
        return {
          success: false,
          toc: [],
          message: 'JSON 文件未生成',
        }
      }

      const jsonContent = fs.readFileSync(jsonFilePath, 'utf-8')
      const jsonResult = JSON.parse(jsonContent)

      // 3. 删除临时 JSON 文件
      fs.unlinkSync(jsonFilePath)

      // 4. 从 kids 中提取标题（原始解析数据，未经过 chunk 处理）
      const kids = jsonResult?.kids || []
      console.log(`[RAG ParseTOC] OpenDataLoader 返回 ${kids.length} 个元素`)

      // 提取标题类型的元素（根据 type 或 level 判断）
      const headings = kids
        .filter((kid: any) => {
          const type = kid.type?.toLowerCase() || ''
          const level = kid.level || 0
          // 标题类型：heading, h1, h2, h3 或有 level 的
          return type.includes('heading') ||
                 type.includes('h1') ||
                 type.includes('h2') ||
                 type.includes('h3') ||
                 type.includes('title') ||
                 level > 0 ||
                 // 字体较大的也可能是标题
                 (kid.font && kid['font size'] > 12)
        })
        .map((kid: any) => ({
          title: kid.content || kid.text || '',
          pageNumber: kid['page number'] || 1,
          level: kid.level || (kid['font size'] > 16 ? 1 : kid['font size'] > 13 ? 2 : 3),
          type: kid.type,
          fontSize: kid['font size'],
        }))
        .filter((h: any) => h.title && h.title.length > 0 && h.title.length < 200)

      console.log(`[RAG ParseTOC] 提取到 ${headings.length} 个标题`)

      // 5. 去重
      const seen = new Set<string>()
      const uniqueHeadings = headings.filter((h: any) => {
        const key = `${h.title}-${h.pageNumber}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      if (uniqueHeadings.length === 0) {
        return {
          success: false,
          toc: [],
          message: '未从 PDF 中识别到目录结构',
        }
      }

      // 6. 转换为标准格式
      const toc = uniqueHeadings.map((h: any) => ({
        title: h.title,
        pageNumber: h.pageNumber,
        level: h.level,
      }))

      return {
        success: true,
        toc,
        message: `成功解析 ${toc.length} 个目录项`,
      }
    } catch (err: any) {
      console.error('[RAG ParseTOC] 解析失败:', err)
      return {
        success: false,
        toc: [],
        message: `解析失败: ${err.message}`,
      }
    }
  })

  // ========== Agent 系统 ==========
  ipcMain.handle('rag:agent_query', async (_, params: {
    pdfId: string,
    query: string,
    config: { provider: string; baseUrl: string; apiKey: string; model: string; embeddingModel?: string; webSearchApiKey?: string },
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    images?: string[] // 新增：图片 base64 data URL 数组
  }) => {
    try {
      const { pdfId, query, config, history = [], images } = params
      console.log('[ReAct Agent] 开始执行，用户输入:', query)
      if (images && images.length > 0) {
        console.log(`[ReAct Agent] 包含 ${images.length} 张图片`)
      }
      
      const result = await runReActAgentWithHistory(query, pdfId, config, history, images)
      
      if (result.success) {
        console.log('[ReAct Agent] 执行成功')
        return { success: true, output: result.output, steps: result.steps }
      } else {
        console.error('[ReAct Agent] 执行失败:', result.error)
        return { success: false, message: result.error }
      }
    } catch (err: any) {
      console.error('[ReAct Agent] 执行失败:', err)
      return { success: false, message: `Agent 执行失败: ${err.message}` }
    }
  })
}
