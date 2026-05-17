import 'dotenv/config'
import path from 'path'
import os from 'os'

process.env.ELECTRON_RUN_AS_NODE = '1'

globalThis.mockElectronDb = true

const Module = require('module')
const originalLoad = Module._load
Module._load = function (request: string, parent: any, isMain: boolean) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (name: string) => {
          if (name === 'userData') return path.join(os.tmpdir(), 'pdf-reader-test-agent')
          return os.tmpdir()
        },
        getName: () => 'pdf-reader'
      },
      net: { fetch: fetch },
    }
  }
  if (request.match(/better-sqlite3/)) {
    const Database = require('better-sqlite3')
    return function(...args: any[]) {
      const db = new Database(...args)
      db.exec(`
        CREATE TABLE IF NOT EXISTS pdf_chunks (
          pdf_id TEXT, chunk_no INTEGER, text TEXT, file_path TEXT DEFAULT '',
          embeddings BLOB DEFAULT NULL
        );
        INSERT OR IGNORE INTO pdf_chunks(pdf_id, chunk_no, text, file_path)
        VALUES ('test-agent-pdf-id', 0, 'Machine learning.', 'dummy.pdf');
      `)
      return db
    }
  }
  return originalLoad.apply(this, arguments)
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗')
  console.log('║        🔥 Agent 官方函数测试 1:1 复用你的业务逻辑代码          ║')
  console.log('╚═══════════════════════════════════════════════════════════╝\n')

  const { runReActAgentWithHistory } = require('../src/main/services/reactAgentService')

  const config = {
    provider: process.env.AI_PROVIDER || 'zhipu',
    baseUrl: process.env.AI_BASE_URL || '',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || '',
  }

  console.log(`配置: ${config.model} @ ${config.baseUrl}\n`)

  const TEST_QUERIES = [
    '水的化学式是什么？',
    '比特币现在的价格是多少美元？',
    '帮我在arxiv上找几篇关于transformer的论文',
  ]

  const allTimes: any[] = []

  for (let i=0; i<TEST_QUERIES.length; i++) {
    const query = TEST_QUERIES[i]
    console.log('─'.repeat(70))
    console.log(`\nRound ${i+1}/${TEST_QUERIES.length}\n👤 User: "${query}"\n`)
    const t0 = Date.now()

    try {
      const result = await runReActAgentWithHistory(query, 'test-agent-pdf-id', config, [])
      console.log(`✅ Agent 函数返回 (总耗时: ${Date.now()-t0}ms)`)

      if (result.success && Array.isArray(result.steps)) {
        console.log(`\n📋 推理步骤(和你真实软件完全一致):`)
        for (const step of result.steps) {
          const took = step.durationMs ? `(${step.durationMs}ms)` : ''
          if (step.toolName) {
            console.log(`  [${step.step}] 🔧 ${step.toolName} ${took}`)
            console.log(`         args: ${JSON.stringify(step.toolInput)}`)
          }
          if (step.isAnswer) {
            const short = (step.log||'').replace(/\n/g,' ').substring(0,100)
            console.log(`  [${step.step}] 💬 最终回答 ${took}`)
            console.log(`         ${short}...`)
          }
        }
      }
      allTimes.push({ query, ok: result.success, total: Date.now()-t0, steps: result.steps })
    } catch(e: any) {
      console.log(`🔥 Exception:`, e.message)
      console.log(e.stack)
      allTimes.push({ query, ok: false, total: Date.now()-t0 })
    }
  }

  console.log('\n'+'═'.repeat(70)+'\n📊 官方函数全链路耗时汇总\n')
  for (const r of allTimes) {
    let desc = ''
    if (r.ok && Array.isArray(r.steps)) {
      const tools = r.steps.filter((x: any) => x.toolName).map((x: any) => x.toolName)
      desc = tools.length ? `(调用工具: ${tools.join(',')})` : '(纯常识回答)'
    }
    console.log(`  ${String(r.total).padStart(7)}ms - "${r.query.substring(0,36)}${r.query.length>36?'...':''}" ${desc}`)
  }
  if (allTimes.length) {
    const avg = Math.round(allTimes.reduce((s: number,x: any)=>s+x.total,0)/allTimes.length)
    console.log(`\n  ═════════════════════════════════`)
    console.log(`  🟠 用户侧端到端平均等待: ${avg}ms (${(avg/1000).toFixed(1)}秒)`)
    console.log(`  ═════════════════════════════════`)
  }
  console.log()
}
main().catch(e => { console.error('FATAL:', e); process.exit(1) })
