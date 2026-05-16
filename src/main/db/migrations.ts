import type Database from 'better-sqlite3'

// ========== 数据库版本（每次改表结构时递增）==========
const CURRENT_DB_VERSION = 4

/**
 * 数据库迁移入口
 * 按版本逐步升级，确保不重复执行
 */
export function migrate(db: Database.Database): void {
  // 1. 创建版本表
  db.exec(`
    CREATE TABLE IF NOT EXISTS db_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `)

  // 2. 读取当前版本
  const row = db.prepare(`
    SELECT value FROM db_meta WHERE key = 'version'
  `).get() as { value: string } | undefined

  let version = row ? Number(row.value) : 0
  console.log(`[DB] 当前版本: v${version}, 目标版本: v${CURRENT_DB_VERSION}`)

  // 3. 按版本逐步升级
  if (version < 1) {
    console.log('[DB] 升级到 v1: 初始化 RAG 表')
    migrateV1(db)
    setVersion(db, 1)
    version = 1
  }

  if (version < 2) {
    console.log('[DB] 升级到 v2: 添加语义化字段')
    migrateV2(db)
    setVersion(db, 2)
    version = 2
  }

  if (version < 3) {
    console.log('[DB] 升级到 v3: 添加 embedding_model 字段')
    migrateV3(db)
    setVersion(db, 3)
    version = 3
  }

  if (version < 4) {
    console.log('[DB] 升级到 v4: 添加父子双块字段')
    migrateV4(db)
    setVersion(db, 4)
    version = 4
  }

  console.log(`[DB] ✅ Migration 完成，当前版本: v${version}`)

  // 🔍 调试：验证 rag_index_meta 表结构
  const cols = db.prepare(`PRAGMA table_info(rag_index_meta)`).all() as { name: string }[]
  console.log('[DB] rag_index_meta 列:', cols.map((c) => c.name).join(', '))
}

/**
 * 设置数据库版本
 */
function setVersion(db: Database.Database, v: number): void {
  db.prepare(`
    INSERT INTO db_meta (key, value)
    VALUES ('version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(v))
}

/**
 * v1: 初始化 RAG 相关表（包含最终完整结构）
 */
function migrateV1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pdf_chunks (
      id TEXT PRIMARY KEY,
      pdf_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_pdf ON pdf_chunks(pdf_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_file ON pdf_chunks(file_path);

    CREATE TABLE IF NOT EXISTS rag_index_meta (
      pdf_id TEXT PRIMARY KEY,
      version INTEGER DEFAULT 1,
      chunk_count INTEGER DEFAULT 0,
      indexed_at INTEGER DEFAULT (unixepoch() * 1000),
      file_hash TEXT,
      embedding_model TEXT  -- v3 添加，但新表直接包含
    );
  `)
}

/**
 * v2: 添加语义化字段
 */
function migrateV2(db: Database.Database): void {
  // 添加字段（try/catch 防止重复添加报错）
  const columns = [
    { name: 'section', type: 'TEXT' },
    { name: 'section_level', type: 'INTEGER' },
    { name: 'type', type: "TEXT DEFAULT 'paragraph'" },
    { name: 'bbox', type: 'TEXT' },
    { name: 'char_range', type: 'TEXT' },
    { name: 'prev_id', type: 'TEXT' },
    { name: 'next_id', type: 'TEXT' },
    { name: 'parent_id', type: 'TEXT' },
    { name: 'keywords', type: 'TEXT' },
    { name: 'importance', type: 'REAL DEFAULT 0.5' },
    { name: 'tokens', type: 'INTEGER DEFAULT 0' },
  ]

  for (const col of columns) {
    try {
      db.exec(`ALTER TABLE pdf_chunks ADD COLUMN ${col.name} ${col.type}`)
    } catch {
      // 已存在则忽略
    }
  }

  // 添加索引
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_chunks_type ON pdf_chunks(type)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_chunks_section ON pdf_chunks(section)')
  } catch {}
}

/**
 * v3: 添加 embedding_model 字段（幂等：检测是否存在）
 */
function migrateV3(db: Database.Database): void {
  // 🔥 先检查列是否存在（防止 version 和 schema 不同步）
  const cols = db.prepare(`PRAGMA table_info(rag_index_meta)`).all() as { name: string }[]
  const hasColumn = cols.some((c) => c.name === 'embedding_model')

  if (hasColumn) {
    console.log('[DB] embedding_model 列已存在，跳过')
    return
  }

  console.log('[DB] 添加 embedding_model 列')
  db.exec('ALTER TABLE rag_index_meta ADD COLUMN embedding_model TEXT')
}

/**
 * v4: 添加父子双块字段
 */
function migrateV4(db: Database.Database): void {
  // 添加字段（try/catch 防止重复添加报错）
  const columns = [
    { name: 'parent_id', type: 'TEXT' },
    { name: 'child_ids', type: 'TEXT' },  // JSON 数组
    { name: 'chunk_role', type: "TEXT DEFAULT 'child'" },  // 'parent' | 'child' | 'both'
    { name: 'group_key', type: 'TEXT' },
  ]

  for (const col of columns) {
    try {
      db.exec(`ALTER TABLE pdf_chunks ADD COLUMN ${col.name} ${col.type}`)
      console.log(`[DB] 添加列: ${col.name}`)
    } catch {
      // 已存在则忽略
      console.log(`[DB] 列已存在: ${col.name}`)
    }
  }

  // 添加索引
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_parent_id ON pdf_chunks(parent_id)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_chunk_role ON pdf_chunks(chunk_role)')
    console.log('[DB] 创建索引: idx_parent_id, idx_chunk_role')
  } catch {}
}
