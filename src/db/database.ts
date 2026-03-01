// SQLite 数据库封装（better-sqlite3 + WAL 模式）
import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createLogger } from '../utils/logger.js'
import { runMigrations } from './migrations.js'

const log = createLogger('database')

/** 应用数据库 */
export class AppDatabase {
  readonly db: Database.Database

  constructor(dbPath: string) {
    // 确保数据目录存在
    mkdirSync(dirname(dbPath), { recursive: true })

    this.db = new BetterSqlite3(dbPath)

    // 启用 WAL 模式和外键约束
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')

    // 执行迁移
    runMigrations(this.db)

    log.info({ dbPath }, '数据库初始化完成')
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close()
    log.info('数据库连接已关闭')
  }
}
