const path = require('path')
const os = require('os')
const Module = require('module')

process.on('uncaughtException', (e) => console.error('uncaughtException:', e))
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e))

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (name) => {
          if (name === 'userData') return path.join(os.tmpdir(), 'pdf-reader-test-agent')
          return os.tmpdir()
        },
        getName: () => 'pdf-reader'
      },
      net: { fetch: (...args) => import('node-fetch').then(({default:f})=>f(...args)) }
    }
  }
  if (request.match(/better-sqlite3/)) {
    const Database = require('better-sqlite3')
    const orig = function(...args) {
      const db = new Database(...args)
      db.exec(`
        CREATE TABLE IF NOT EXISTS pdf_chunks (
          pdf_id TEXT, chunk_no INTEGER, text TEXT,
          file_path TEXT DEFAULT '',
          embeddings BLOB DEFAULT NULL
        );
        CREATE TABLE IF NOT EXISTS pdf_info (
          pdf_id TEXT PRIMARY KEY, file_path TEXT, file_name TEXT,
          page_count INTEGER DEFAULT 0, indexed_pages INTEGER DEFAULT 0
        );
        INSERT OR IGNORE INTO pdf_chunks(pdf_id, chunk_no, text, file_path)
        VALUES ('test-agent-pdf-id', 0, 'Machine learning is a field of study.', 'dummy.pdf');
      `)
      return db
    }
    orig.default = orig
    return orig
  }
  return originalLoad.apply(this, arguments)
}

async function main() {
  require('dotenv').config()

  console.log('╔═══════════════════════════════════════════════════════════╗')
  console.log('║        🔥 Agent 官方函数测试 1:1 复用你的业务逻辑代码          ║')
  console.log('╚═══════════════════════════════════════════════════════════╝\n')

  const { runReActAgentWithHistory } = require('../src/main/services/reactAgentService')

  const config = {
    provider: process.env.AI_PROVIDER || 'zhipu',
    baseUrl: process.env.AI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'GLM-4.6v',
  }

  console.log(`调用你的 Agent 函数: runReActAgentWithHistory(query, "test-agent-pdf-id", config, history)\n`)
  console.log(`模型配置: ${config.model} @ ${config.baseUrl}\n`)

  const TEST_QUERIES = [
    '水的化学式是什么？',
    '比特币现在的价格是多少美元？',
    '帮我在arxiv上找几篇关于transformer的论文',
  ]

  const allTimes = []

  for (let i=0; i<TEST_QUERIES.length; i++) {
    const query = TEST_QUERIES[i]
    console.log(`─`.repeat(70))
    console.log(`\nRound ${i+1}/${TEST_QUERIES.length}: 正在运行你的 Agent...\n`)
    console.log(`  👤 User: "${query}"`)
    const t0 = Date.now()

    try {
      const result = await runReActAgentWithHistory(query, 'test-agent-pdf-id', config, [])
      console.log(`\n  ✅ Agent 函数返回 (耗时: ${Date.now()-t0}ms)`)
      console.log(`  success:`, result.success)

      if (result.success && Array.isArray(result.steps)) {
        console.log(`\n  📋 Agent 推理步骤:`)
        for (const step of result.steps) {
          const toolName = step.toolName || (step.isAnswer? '💬 最终回答' : '')
          const took = step.durationMs? `(${step.durationMs}ms)` : ''
          console.log(`    [step ${step.step}] ${toolName} ${took}`)
          if (step.toolName && step.toolInput) {
            console.log(`       input: ${JSON.stringify(step.toolInput).substring(0,80)}`)
          }
          if (step.isAnswer && step.log) {
            const short = step.log.replace(/\n/g,' ').substring(0,100)
            console.log(`       ${short}...`)
          }
        }
      }
      if (result.output) {
        const short = result.output.replace(/\n/g,' ').substring(0,120)
        console.log(`\n  📤 最终输出: "${short}..."`)
      }
      if (!result.success) {
        console.log(`\n  ❌ Error:`, result.error||result)
      }
      allTimes.push({ query, ok: result.success, total: Date.now()-t0, steps: result.steps })
    } catch(e) {
      console.log(`\n  🔥 Agent 函数抛出异常:`, e.message)
      console.log(e.stack)
      allTimes.push({ query, ok: false, total: Date.now()-t0, error: e.message })
    }
  }

  console.log(`\n`+`═`.repeat(70))
  console.log(`📊 官方函数全链路耗时汇总\n`)
  for (const r of allTimes) {
    let toolSteps = ''
    if (r.ok && Array.isArray(r.steps)) {
      const tools = r.steps.filter(x => x.toolName).map(x => x.toolName).join(',')
      toolSteps = tools ? ` tools: [${tools}]` : ' (纯常识回答)'
    }
    console.log(`  ${String(r.total).padStart(7)}ms  - "${r.query.substring(0,35)}${r.query.length>35?'...':''}"${toolSteps}`)
  }
  console.log()
  if (allTimes.length) {
    const avg = Math.round(allTimes.reduce((s,x)=>s+x.total,0) / allTimes.length)
    console.log(`  ══════════════════════════════`)
    console.log(`  用户侧端侧平均等待: ${avg}ms (${(avg/1000).toFixed(1)}秒)`)
    console.log(`  ══════════════════════════════`)
  }
  console.log()
}
main().catch(e => { console.error('FATAL:', e); process.exit(1) })
