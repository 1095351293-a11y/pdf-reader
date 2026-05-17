const path = require('path')
const os = require('os')
const Module = require('module')

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (name) => {
          if (name === 'userData') return path.join(os.tmpdir(), 'pdf-reader-test')
          return os.tmpdir()
        }
      },
      net: { fetch: (...args) => import('node-fetch').then(({default:f})=>f(...args)) }
    }
  }
  return originalLoad.apply(this, arguments)
}

async function main() {
  require('dotenv').config()
  const axios = require('axios')

  console.log('╔═══════════════════════════════════════════════════════════╗')
  console.log('║               Agent 完整全链路测试 (真调用工具)              ║')
  console.log('║   📊 含: 模型决策+工具执行+结果二次处理,和真实用户体验一致    ║')
  console.log('╚═══════════════════════════════════════════════════════════╝\n')

  const config = {
    baseUrl: (process.env.AI_BASE_URL||'').replace(/\/+$/, '') || 'https://api.openai.com/v1',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
  }
  console.log(`模型: ${config.model} @ ${config.baseUrl}\n`)

  const SYSTEM_PROMPT = `你是专业的PDF阅读助手。可用工具:
- search_arxiv: 搜索arXiv学术论文
- web_search: 联网搜索实时信息(股价、天气、新闻等)
规则: 需要外部信息就调用工具，不要瞎编；常识可以直接回答。`

  const TOOLS_DEFINITION = [
    {
      type: 'function',
      function: {
        name: 'search_arxiv',
        description: 'Search arXiv academic papers.',
        parameters: { type:'object', properties:{ query:{type:'string'} }, required:['query'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Get real-time info from web.',
        parameters: { type:'object', properties:{ query:{type:'string'} }, required:['query'] },
      },
    },
  ]

  async function chatCompletions(messages, toolChoice='auto') {
    const t0 = Date.now()
    try {
      const res = await axios.post(
        `${config.baseUrl}/chat/completions`,
        {
          model: config.model,
          messages: [{role:'system', content: SYSTEM_PROMPT}, ...messages],
          tools: TOOLS_DEFINITION,
          tool_choice: toolChoice,
          temperature: 0.1,
        },
        { headers: { Authorization: `Bearer ${config.apiKey}` }, timeout: 120000 }
      )
      return { ...res.data.choices?.[0]?.message, duration: Date.now()-t0, ok:true }
    } catch(e) {
      return { ok:false, error: e.response?.data || e.message, duration: Date.now()-t0 }
    }
  }

  async function callRealTool(name, args) {
    // 模拟你真实的工具实现
    const t0 = Date.now()
    let result = ''
    try {
      if (name === 'web_search') {
        // 真实调用你的 web_search 流程
        const searchUrl = `https://search.tinyfish.ai/api/search?query=${encodeURIComponent(args.query)}&lang=zh-CN`
        const searchRes = await axios.get(searchUrl, { timeout: 15000 })
        const results = searchRes.data?.value || []
        result = `Web search "${args.query}" returned ${results.length} results:\n`
        for (let i=0; i<Math.min(3, results.length); i++) {
          result += `  ${i+1}. ${results[i].title?.substring(0,50)}\n`
        }
      } else if (name === 'search_arxiv') {
        const query = encodeURIComponent(args.query)
        const arxivUrl = `http://export.arxiv.org/api/query?search_query=all:${query}&max_results=3`
        const axRes = await axios.get(arxivUrl, { timeout:10000 })
        result = `arXiv search "${args.query}" returned.`
      } else {
        result = `Unknown tool ${name}`
      }
    } catch(e) {
      result = `${name} failed: ${e.message}`
    }
    return { content: result, duration: Date.now()-t0 }
  }

  async function runFullAgentTurn(userQuery) {
    console.log(`\n👤 User: "${userQuery}"`)
    const totalT0 = Date.now()
    const breakdown = []
    const messages = [{role:'user', content: userQuery}]

    let step1 = await chatCompletions(messages)
    if (!step1.ok) {
      console.log(`  ❌ LLM调用失败: ${JSON.stringify(step1.error)}`)
      return { ok:false }
    }

    const hasTool = Array.isArray(step1.tool_calls) && step1.tool_calls.length>0
    console.log(`  🤖 模型决策: ${hasTool?`调用工具[${step1.tool_calls.map(x=>x.function.name).join(',')}]`:'直接回答'} (${step1.duration}ms)`)
    breakdown.push({ name: '模型决策', ms: step1.duration, type: hasTool?'tool':'answer' })

    if (!hasTool) {
      const answerPreview = (step1.content||'').replace(/\n/g,' ').substring(0,60)
      console.log(`  💬 最终回答: "${answerPreview}..."`)
      console.log(`  ⏱️  用户侧总耗时: ${Date.now()-totalT0}ms (纯回答)`)
      breakdown.push({ name: '总耗时', ms: Date.now()-totalT0 })
      return { ok:true, breakdown }
    }

    // ========== 工具真实执行 =============
    const toolCalls = step1.tool_calls
    for (const tc of toolCalls) {
      let funcArgs = {}
      try { funcArgs = JSON.parse(tc.function.arguments) } catch {}
      console.log(`     正在执行: ${tc.function.name}(${JSON.stringify(funcArgs)}) ...`)
      const toolResult = await callRealTool(tc.function.name, funcArgs)
      console.log(`     🔧 ${tc.function.name} 执行完毕: (${toolResult.duration}ms)`)
      breakdown.push({ name: `工具:${tc.function.name}`, ms: toolResult.duration, type:'tool-exec' })
      messages.push({ role: 'assistant', tool_calls: [tc] })
      messages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult.content })
    }

    // ========== 工具结果回给模型,生成最终答案 =============
    console.log(`     将工具结果送回模型生成最终答案 ...`)
    let finalAnswer = await chatCompletions(messages, 'none')
    if (!finalAnswer.ok) {
      console.log(`     ❌ 最终答案生成失败`)
      return { ok:false }
    }
    breakdown.push({ name: '生成最终答案', ms: finalAnswer.duration, type: 'final-answer' })
    breakdown.push({ name: '用户侧总耗时', ms: Date.now()-totalT0, type: 'total' })

    const answerPreview = (finalAnswer.content||'').replace(/\n/g,' ').substring(0,60)
    console.log(`  💬 最终回答: "${answerPreview}..."`)
    console.log(`  ⏱️  用户侧总耗时: ${Date.now()-totalT0}ms = ${breakdown.filter(x=>x.type!=='total').map(x=>x.ms).join('+')}`)
    return { ok:true, breakdown }
  }

  const TEST_SCENARIOS = [
    { name: '纯常识问答', query: '水的化学式是什么？' },
    { name: '布朗运动常识问答测试', query: '你知道什么是布朗运动吗' },
    { name: '实时信息+工具调用全链路', query: '比特币现在价格多少美元？' },
    { name: '学术论文搜索工具', query: '推荐几篇关于transformer的经典论文' },
  ]

  console.log('─'.repeat(70))
  const allBreakdowns = []
  for (const sc of TEST_SCENARIOS) {
    console.log(`\n【${sc.name}】`)
    const r = await runFullAgentTurn(sc.query)
    if (r.breakdown) allBreakdowns.push(...r.breakdown)
  }
  console.log('\n'+'─'.repeat(70))

  // ===== 聚合统计======
  console.log('\n📊 全链路耗时汇总统计\n')
  for (const name of ['模型决策', '工具:web_search', '工具:search_arxiv', '生成最终答案']) {
    const items = allBreakdowns.filter(x => x.name === name)
    if (items.length===0) continue
    const avg = Math.round(items.reduce((s,x)=>s+x.ms,0)/items.length)
    console.log(`  ${name.padEnd(24)} n=${items.length}  平均: ${String(avg).padStart(6)}ms`)
  }
  const totals = allBreakdowns.filter(x => x.name === '用户侧总耗时')
  if (totals.length) {
    const avgTotal = Math.round(totals.reduce((s,x)=>s+x.ms,0)/totals.length)
    console.log(`  ${'─'.repeat(60)}`)
    console.log(`  🔴 用户侧完整端到端平均:   ${avgTotal}ms (${(avgTotal/1000).toFixed(1)} 秒)`)
  }
  console.log('\n')
}
main().catch(console.error)
