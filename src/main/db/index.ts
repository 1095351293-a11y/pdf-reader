import Database from 'better-sqlite3'
import { join } from 'path'
import { app } from 'electron'

let db: Database.Database | null = null

/** RAG 索引版本号 - 修改 chunk 结构时递增，触发自动重新索引 */
export const RAG_INDEX_VERSION = 3  // v3: 基于结构化元素的智能分块

export function initDatabase(): Database.Database {
  if (db) return db

  const dbPath = join(app.getPath('userData'), 'pdf-reader.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  // 创建/更新元数据表（存储版本号）
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  // 检查/更新 RAG 版本号
  const versionRow = db.prepare("SELECT value FROM metadata WHERE key = 'rag_index_version'").get() as { value: string } | undefined
  const currentVersion = parseInt(versionRow?.value || '0', 10)

  if (currentVersion < RAG_INDEX_VERSION && currentVersion > 0) {
    console.log(`[DB] RAG 索引版本升级: ${currentVersion} → ${RAG_INDEX_VERSION}，需要重新索引`)
    // 清空旧索引数据（结构不兼容）
    db.exec('DELETE FROM pdf_chunks')
    db.exec('DELETE FROM pdf_documents WHERE id NOT IN (SELECT DISTINCT pdf_id FROM pdf_chunks)')
    // 更新版本号
    db.prepare(`INSERT OR REPLACE INTO metadata (key, value) VALUES ('rag_index_version', ?)`).run(String(RAG_INDEX_VERSION))
  }

  // 创建表结构
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      path TEXT,
      parent_id TEXT,
      sort_order INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      deleted_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS pdf_documents (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      total_pages INTEGER,
      current_page INTEGER DEFAULT 1,
      scale REAL DEFAULT 1.0,
      reading_progress REAL DEFAULT 0,
      page_mapping TEXT,
      bookmarks TEXT,
      annotations TEXT,
      system_prompt TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      pdf_id TEXT,
      title TEXT NOT NULL,
      system_prompt TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      attachments TEXT,
      page_ref INTEGER,
      timestamp INTEGER DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_files_parent ON files(parent_id);
    CREATE INDEX IF NOT EXISTS idx_files_deleted ON files(is_deleted);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id);

    -- RAG：PDF 语义化分块 + 向量索引（工业级方案）
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
  `)

  // ========== 数据库迁移：添加新字段 ==========
  const migrationColumns = [
    'element_type TEXT',
    'section TEXT',
    'section_level INTEGER',
    'type TEXT DEFAULT "paragraph"',
    'bbox TEXT',
    'char_range TEXT',
    'prev_id TEXT',
    'next_id TEXT',
    'parent_id TEXT',
    'child_ids TEXT',
    'keywords TEXT',
    'importance REAL DEFAULT 0.5',
    'tokens INTEGER DEFAULT 0',
    'chunk_role TEXT',
    'group_key TEXT'
  ]

  for (const column of migrationColumns) {
    try {
      db.exec(`ALTER TABLE pdf_chunks ADD COLUMN ${column}`)
      console.log(`[DB] 添加字段: ${column}`)
    } catch (e) {
      // 字段已存在，忽略
    }
  }

  // 添加索引
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_chunks_type ON pdf_chunks(type)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_chunks_section ON pdf_chunks(section)')
  } catch (e) {
    // 索引已存在，忽略
  }

  return db
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
