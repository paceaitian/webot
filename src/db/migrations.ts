// 数据库版本化建表
import type Database from 'better-sqlite3'

/** 数据库迁移定义 */
interface Migration {
  version: number
  description: string
  up: (db: Database.Database) => void
}

/** 所有迁移 */
const migrations: Migration[] = [
  {
    version: 1,
    description: '创建 messages 和 jobs 表',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          event_id TEXT UNIQUE NOT NULL,
          source TEXT NOT NULL,
          content_json TEXT NOT NULL,
          received_at TEXT NOT NULL,
          processed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL REFERENCES messages(id),
          status TEXT NOT NULL DEFAULT 'pending',
          stage TEXT,
          result_json TEXT,
          error_text TEXT,
          retry_count INTEGER NOT NULL DEFAULT 0,
          next_retry_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
        CREATE INDEX IF NOT EXISTS idx_jobs_next_retry ON jobs(next_retry_at);
      `)
    },
  },
  {
    version: 2,
    description: 'jobs 表新增 extracted_json 缓存列',
    up(db) {
      db.exec('ALTER TABLE jobs ADD COLUMN extracted_json TEXT')
    },
  },
  {
    version: 3,
    description: 'Agent 多轮对话 sessions 表',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          messages TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          metadata TEXT
        )
      `)
    },
  },
]

/**
 * 执行数据库迁移，自动跳过已执行的版本
 */
export function runMigrations(db: Database.Database): void {
  // 创建迁移版本表
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      description TEXT,
      applied_at TEXT NOT NULL
    )
  `)

  const currentVersion = db.prepare(
    'SELECT MAX(version) as ver FROM schema_version'
  ).get() as { ver: number | null }

  const applied = currentVersion?.ver ?? 0

  for (const migration of migrations) {
    if (migration.version > applied) {
      migration.up(db)
      db.prepare(
        'INSERT INTO schema_version (version, description, applied_at) VALUES (?, ?, ?)'
      ).run(migration.version, migration.description, new Date().toISOString())
    }
  }
}
