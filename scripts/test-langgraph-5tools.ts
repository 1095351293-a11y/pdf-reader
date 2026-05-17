import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import axios from 'axios'
import path from 'path'
import fs from 'fs'
import os from 'os'

console.log('╔═══════════════════════════════════════════════════════════╗')
console.log('║           🦜🕸️  LangGraph Agent - 完整 5 工具版              ║')
console.log('║     search_docs / summarize_document / get_page /          ║')
console.log('║     web_search / search_arxiv                              ║')
console.log('╚═══════════════════════════════════════════════════════════╝\n')

// ===== PDF 模拟数据库 / 从你的 reactAgentService 完整复制 =====
function getDatabase() {
  const dbFile = path.join(os.tmpdir(), 'pdf-langgraph-test.db')
  const Database = require('better-sqlite3')
  const db = new Database(dbFile)
  db.exec(`
    CREATE TABLE IF NOT EXISTS pdf_chunks (
      pdf_id TEXT, chunk_no INTEGER, text TEXT, file_path TEXT, page_no INTEGER DEFAULT 1
    );
    INSERT OR IGNORE INTO pdf_chunks(pdf_id, chunk_no, text, file_path, page_no) VALUES
    ('test-agent-pdf-id', 0, 'Machine learning (ML) is a field of study in artificial intelligence. ML algorithms are used to make predictions or decisions without being explicitly programmed. Supervised learning, unsupervised learning, and reinforcement learning are the three main paradigms. Deep learning is a subset of machine learning based on neural networks with multiple layers. Transformers (Attention Is All You Need, 2017) have become the dominant architecture for modern deep learning models.', 'test-machine-learning.pdf', 1),
    ('test-agent-pdf-id', 1, 'Natural language processing (NLP) is a subfield of linguistics, computer science, and artificial intelligence concerned with interactions between computers and human language. Large language models (LLMs) like GPT, BERT, T5 are transformer-based models that achieve state-of-the-art performance on many NLP benchmarks.', 'test-machine-learning.pdf', 2),
    ('test-agent-pdf-id', 2, 'Page 3 content: Transformer architecture uses multi-head attention mechanism, positional encoding, feed-forward networks, residual connections and layer normalization. "Attention Is All You Need" was published by Vaswani et al. in 2017 at NeurIPS.', 'test-machine-learning.pdf', 3);
  `)
  return db
}

// ============ 1. 完整 5 工具定义 ============

const searchDocsTool = tool(
  async ({ query }) => {
    console.log(`  [🔧 search_docs] query="${query}"`)
    const t0 = Date.now()
    try {
      const db = getDatabase()
      const pdfId = 'test-agent-pdf-id'
      const results = db.prepare(
        `SELECT text, page_no FROM pdf_chunks WHERE pdf_id = ? AND (text LIKE ? OR text LIKE ?) LIMIT 5`
      ).all(pdfId, `%${query.split(' ')[0]}%`, `%${query.split(' ').slice(-1)[0]}%`)
      db.close()
      const output = Array.isArray(results) ? results.map((r: any) => 
        `[page ${r.page_no}] ${r.text}`
      ).join('\n---\n') : ''
      console.log(`     search_docs 返回 ${(output.match(/\n/g)||[]).length+1} 片段 (${Date.now()-t0}ms)`)
      return output || `No relevant text found for query: ${query}`
    } catch (e) {
      return `search_docs failed: ${(e as any).message}`
    }
  },
  {
    name: 'search_docs',
    description: 'Search content inside the currently opened PDF document.',
    schema: z.object({
      query: z.string().describe('Keywords or questions to search inside the PDF document'),
    }),
  }
)

const summarizeDocumentTool = tool(
  async () => {
    console.log(`  [🔧 summarize_document]`)
    const t0 = Date.now()
    try {
      const db = getDatabase()
      const all = db.prepare(`SELECT text FROM pdf_chunks WHERE pdf_id = 'test-agent-pdf-id' ORDER BY chunk_no`).all() as any[]
      db.close()
      const output = all.map((r: any) => r.text).join('\n')
      console.log(`     summarize_document, 共 ${output.length} 字符 (${Date.now()-t0}ms)`)
      return `Document summary candidate (raw): ${output.substring(0, 1500)}`
    } catch (e) {
      return `summarize_document failed: ${(e as any).message}`
    }
  },
  {
    name: 'summarize_document',
    description: 'Summarize the entire currently opened PDF document.',
    schema: z.object({}),
  }
)

const getPageTool = tool(
  async ({ pageNumber }) => {
    console.log(`  [🔧 get_page] pageNumber=${pageNumber}`)
    const t0 = Date.now()
    try {
      const db = getDatabase()
      const row = db.prepare(
        `SELECT text FROM pdf_chunks WHERE pdf_id = 'test-agent-pdf-id' AND page_no = ? LIMIT 1`
      ).get(pageNumber) as any
      db.close()
      const output = row?.text || `Page ${pageNumber} content not found`
      console.log(`     get_page 返回 length=${output.length} (${Date.now()-t0}ms)`)
      return output
    } catch (e) {
      return `get_page failed: ${(e as any).message}`
    }
  },
  {
    name: 'get_page',
    description: 'Get content of a specific page by page number from the PDF.',
    schema: z.object({
      pageNumber: z.coerce.number().int().min(1).describe('Page number starting from 1'),
    }),
  }
)

const webSearchTool = tool(
  async ({ query }) => {
    console.log(`  [🔧 web_search] query="${query}"`)
    const t0 = Date.now()
    try {
      const searchUrl = `https://search.tinyfish.ai/api/search?query=${encodeURIComponent(query)}&lang=zh-CN`
      const res = await axios.get(searchUrl, { timeout: 8000 })
      const results = res.data?.value || []
      const output = results.map((r: any, i: number) => 
        `[${i+1}] ${r.title}\n${r.url}\n${r.snippet||''}`
      ).join('\n\n')
      console.log(`     web_search 返回 ${results.length} 条结果 (${Date.now()-t0}ms)`)
      return output || `No results found for ${query}`
    } catch (e) {
      console.log(`     工具失败: ${(e as any).message} (${Date.now()-t0}ms)`)
      return `Web search failed: ${(e as any).code} ${(e as any).message}`
    }
  },
  {
    name: 'web_search',
    description: 'Get real-time information, news, data from the internet.',
    schema: z.object({
      query: z.string().describe('Keywords to search online'),
    }),
  }
)

const searchArxivTool = tool(
  async ({ query }) => {
    console.log(`  [🔧 search_arxiv] query="${query}"`)
    const t0 = Date.now()
    try {
      const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=3`
      const res = await axios.get(url, { timeout: 8000 })
      console.log(`     search_arxiv 返回 OK length=${String(res.data).length} (${Date.now()-t0}ms)`)
      return String(res.data).substring(0, 2000)
    } catch (e) {
      console.log(`     工具失败: ${(e as any).message} code=${(e as any).response?.status} (${Date.now()-t0}ms)`)
      return `arXiv failed: HTTP ${(e as any).response?.status || e}`
    }
  },
  {
    name: 'search_arxiv',
    description: 'Search for academic research papers on arXiv.',
    schema: z.object({
      query: z.string().describe('Paper keywords, preferably English'),
    }),
  }
)

// ============ 5 tools loaded ============
const ALL_TOOLS = [searchDocsTool, summarizeDocumentTool, getPageTool, webSearchTool, searchArxivTool]
const toolNode = new ToolNode(ALL_TOOLS as any)

const config = {
  baseUrl: (process.env.AI_BASE_URL || '').replace(/\/+$/, ''),
  apiKey: process.env.AI_API_KEY || '',
  model: process.env.AI_MODEL || '',
}
console.log(`配置: ${config.model} @ ${config.baseUrl}`)
console.log(`工具: ${ALL_TOOLS.map(t => t.name).join(', ')}\n`)

if (!config.apiKey || !config.baseUrl) process.exit(1)

const model = new ChatOpenAI({
  apiKey: config.apiKey,
  model: config.model,
  configuration: { baseURL: config.baseUrl },
  temperature: 0.05,
  timeout: 120000,
}).bindTools(ALL_TOOLS)

async function callModel(state: typeof MessagesAnnotation.State) {
  console.log(`\n  [🦜🕸️ agent] messages.len=${state.messages.length}`)
  const t0 = Date.now()
  const response = await model.invoke(state.messages)
  const took = Date.now() - t0
  if ('tool_calls' in response && response.tool_calls?.length) {
    console.log(`     ↩️  选工具 (${took}ms): [${response.tool_calls.map((x: any)=>x.name).join(', ')}]`)
  } else {
    const short = String(response.content||'').replace(/\n/g,' ').substring(0,60)
    console.log(`     ↩️  直接回答 (${took}ms): "${short}${short.length>59?'...':''}"`)
  }
  return { messages: [response] }
}

function shouldContinue(state: typeof MessagesAnnotation.State): 'tools' | '__end__' {
  const lastMessage: any = state.messages[state.messages.length - 1]
  if ('tool_calls' in lastMessage && lastMessage.tool_calls?.length > 0) {
    return 'tools'
  }
  return '__end__'
}

// Build Graph: START -> agent <=> tools 
const workflow = new StateGraph(MessagesAnnotation)
  .addNode('agent', callModel)
  .addNode('tools', toolNode as any)
  .addEdge('__start__', 'agent')
  .addConditionalEdges('agent', shouldContinue)
  .addEdge('tools', 'agent')

const app = workflow.compile()

// ============ 测试：覆盖 PDF 文档工具的场景 ============
async function main() {
  const PDF_RELATED_TESTS = [
    { q: '这份文档讲了什么主题？', expect: 'summarize_document or search_docs' },
    { q: '第 3 页写了什么内容？', expect: 'get_page with pageNumber=3' },
    { q: '文档里关于 transformer 架构说了什么？', expect: 'search_docs 向量搜索 PDF 内容' },
  ]
  console.log('─'.repeat(70))
  console.log('PDF 工具测试场景 (共 3 个)')
  console.log('─'.repeat(70))

  for (let i=0; i<PDF_RELATED_TESTS.length; i++) {
    const tc = PDF_RELATED_TESTS[i]
    const t0 = Date.now()
    console.log(`\n[Test ${i+1}] Query: "${tc.q}" (expect: ${tc.expect})`)
    try {
      const finalState = await app.invoke({
        messages: [
          { role: 'system', content: `You are a precise PDF document assistant.

Available Tools:
1. search_docs: 搜索当前 PDF 文档内部内容
2. summarize_document: 总结整个当前打开的 PDF 文档
3. get_page: 获取指定页码内容 (pageNumber) 
4. web_search: Only for real-time info/news from internet
5. search_arxiv: Only for academic paper lookup

Rules:
- search_docs / summarize_document / get_page work on currently opened document.
- Use web_search/search_arxiv ONLY when user explicitly wants online information.
- Maximum 1 tool call per query, stop early if you have answer material.`},
          { role: 'user', content: tc.q },
        ]
      }, { recursionLimit: 3 })
      const finalMsg = finalState.messages[finalState.messages.length-1]
      console.log(`\n  🏁 总耗时: ${Date.now()-t0}ms`)
      if ('content' in finalMsg) {
        const short = String(finalMsg.content||'').replace(/\n/g,' ').substring(0,140)
        console.log(`  📤: "${short}${short.length>139?'...':''}"`)
      }
    } catch (e) {
      console.log('  ❌ ', (e as any).message?.substring(0, 80))
    }
  }
  console.log('\n' + '═'.repeat(70) + '\n  LangGraph - Complete 5 Tools Version Done\n' + '═'.repeat(70))
}
main().catch(e => { console.error('\nFATAL:', e); process.exit(1) })
