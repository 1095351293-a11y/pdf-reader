import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import axios from 'axios'

console.log('╔═══════════════════════════════════════════════════════════╗')
console.log('║                🦜🕸️  LangGraph Agent 对比测试                 ║')
console.log('╚═══════════════════════════════════════════════════════════╝\n')

// ===== 1. 工具定义 =====
const webSearchTool = tool(
  async ({ query }) => {
    console.log(`  [🔧 web_search] query="${query}"`)
    const t0 = Date.now()
    try {
      const searchUrl = `https://search.tinyfish.ai/api/search?query=${encodeURIComponent(query)}&lang=zh-CN`
      const res = await axios.get(searchUrl, { timeout: 10000 })
      const results = res.data?.value || []
      const output = results.map((r: any, i: number) => 
        `[${i+1}] ${r.title}\n${r.url}\n${r.snippet||''}`
      ).join('\n\n')
      console.log(`     返回 ${results.length} 条结果 (${Date.now()-t0}ms)`)
      return output || `No results found for ${query}`
    } catch (e) {
      console.log(`     工具失败: ${(e as any).message} (${Date.now()-t0}ms)`)
      return `Search failed: ${(e as any).message}`
    }
  },
  {
    name: 'web_search',
    description: 'Search web for real-time info, news, live prices.',
    schema: z.object({
      query: z.string().describe('Search keywords'),
    }),
  }
)

const searchArxivTool = tool(
  async ({ query }) => {
    console.log(`  [🔧 search_arxiv] query="${query}"`)
    const t0 = Date.now()
    try {
      const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=3`
      const res = await axios.get(url, { timeout: 10000 })
      console.log(`     arXiv 返回 OK (${Date.now()-t0}ms, length=${String(res.data).length} chars)`)
      return String(res.data).substring(0, 2000)
    } catch (e) {
      console.log(`     工具失败: ${(e as any).message} (${Date.now()-t0}ms)`)
      return `arXiv API failed: ${(e as any).message}`
    }
  },
  {
    name: 'search_arxiv',
    description: 'Search academic research papers on arXiv.',
    schema: z.object({
      query: z.string().describe('Search keywords, preferably English for better results.'),
    }),
  }
)

const tools = [webSearchTool, searchArxivTool]
const toolNode = new ToolNode(tools as any)

// ===== 2. 模型初始化 =====
const config = {
  baseUrl: (process.env.AI_BASE_URL || '').replace(/\/+$/, ''),
  apiKey: process.env.AI_API_KEY || '',
  model: process.env.AI_MODEL || '',
}
if (!config.baseUrl || !config.apiKey) {
  console.error('Please set env: AI_BASE_URL, AI_API_KEY, AI_MODEL')
  process.exit(1)
}
console.log(`模型: ${config.model} @ ${config.baseUrl}\n`)

const model = new ChatOpenAI({
  apiKey: config.apiKey,
  model: config.model,
  configuration: { baseURL: config.baseUrl },
  temperature: 0.1,
  timeout: 120000,
}).bindTools(tools)

// ===== 3. LangGraph 核心逻辑: call_model / should_continue =====
async function callModel(state: typeof MessagesAnnotation.State) {
  console.log(`\n  [🦜🕸️ callModel] messages.length=${state.messages.length}`)
  const t0 = Date.now()
  const response = await model.invoke(state.messages)
  console.log(`     model.invoke OK (${Date.now()-t0}ms)`)
  if ('tool_calls' in response && response.tool_calls?.length) {
    console.log(`     模型决策: 调用工具 [${response.tool_calls.map((x: any)=>x.name).join(', ')}]`)
  } else {
    const short = String(response.content||'').replace(/\n/g,' ').substring(0,70)
    console.log(`     模型决策: 直接回答 "${short}${short.length>69?'...':''}"`)
  }
  return { messages: [response] }
}

function shouldContinue(state: typeof MessagesAnnotation.State) {
  const lastMessage: any = state.messages[state.messages.length - 1]
  if ('tool_calls' in lastMessage && lastMessage.tool_calls?.length > 0) {
    return 'tools'
  }
  return '__end__'
}

// ===== 4. 组装 Graph =====
const workflow = new StateGraph(MessagesAnnotation)
  .addNode('agent', callModel)
  .addNode('tools', toolNode as any)
  .addEdge('__start__', 'agent')
  .addConditionalEdges('agent', shouldContinue)
  .addEdge('tools', 'agent')

const app = workflow.compile()

console.log('╔═══════════════════════════════════════════════════════════╗')
console.log('║                        LangGraph Graph                       ║')
console.log('║                                                             ║')
console.log('║     START ──→ agent ───┬───→ tools ──┐                     ║')  
console.log('║                         ↓ (no tool)    │                     ║')
console.log('║                        END             │                     ║')
console.log('║                         └──────────────┘                     ║')
console.log('╚═══════════════════════════════════════════════════════════╝\n')

async function main() {

// ===== 5. 跑测试 =====
const TEST_CASES = [
  { q: '水的化学式是什么？', expect: '常识直接回答' },
  { q: '你知道什么是布朗运动吗', expect: '常识直接回答' },
  { q: '比特币现在价格多少美元？', expect: 'web_search实时数据' },
  { q: 'arxiv上找transformer论文', expect: 'search_arxiv' },
]

const RESULTS = []
for (const tc of TEST_CASES) {
  console.log('\n' + '═'.repeat(70))
  console.log(`🧪 测试: "${tc.q}"`)
  console.log('─'.repeat(70))
  const globalT0 = Date.now()

  const inputs = {
    messages: [
      { role: 'system', content: `You are a helpful document assistant.

      ## Tool Calling Rules
      - Use web_search ONLY for real-time/live information (live prices, news after 2024)
      - Use search_arxiv ONLY when user explicitly asks for academic papers
      - DO NOT use tools for: common well-established knowledge before 2023 (physics, math, formulas, chemistry, historical facts)
      - Direct answer if you are confident; one tool attempt maximum.` },
      { role: 'user', content: tc.q },
    ],
  }

  try {
    let step = 0
    for await (const chunk of await app.stream(inputs, { recursionLimit: 4 })) {
      for (const [node, output] of Object.entries(chunk)) {
        step++
      }
    }
    const finalState = await app.invoke(inputs, { recursionLimit: 4 })
    const lastMsg = finalState.messages.pop()
    console.log(`\n  🏁 LangGraph done! 总耗时: ${Date.now()-globalT0}ms, 最终输出:`)
    const shortAns = String(lastMsg.content||'').replace(/\n/g,' ').substring(0,150)
    console.log(`\n${shortAns}...`)
    RESULTS.push({ ...tc, ok: true, time: Date.now()-globalT0 })
  } catch (e) {
    console.log('  ❌', (e as any).message || String(e))
    RESULTS.push({ ...tc, ok: false, time: Date.now()-globalT0 })
  }
}

// 汇总
console.log('\n' + '═'.repeat(70))
console.log('📊  LangGraph Agent 最终统计\n')
let totalMs = 0
for (const r of RESULTS) {
  totalMs += r.time
  const icon = r.ok ? '✅' : '❌'
  console.log(`  ${String(r.time).padStart(7)}ms  ${icon} "${r.q.substring(0,40)}${r.q.length>40?'...':''}"`)
}
console.log(`\n  ───────────────────────────────────────────────`)
console.log(`  平均端到端耗时: ${Math.round(totalMs/RESULTS.length)}ms`)
console.log('═'.repeat(70) + '\n')

}
main().catch(e => { console.error(e); process.exit(1) })
