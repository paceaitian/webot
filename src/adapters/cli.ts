// CLI 适配器 — readline 交互式输入
import * as readline from 'node:readline'
import { BaseAdapter } from './base.js'
import { CliResponder } from '../responder/cli.js'
import type { RawMessage } from '../types/index.js'
import type { PipelineEngine } from '../pipeline/engine.js'
import { generateId } from '../utils/id.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('cli-adapter')

/** CLI 适配器 — 每行输入构造 RawMessage 送入管道 */
export class CliAdapter extends BaseAdapter {
  private rl: readline.Interface | null = null
  private responder = new CliResponder()

  constructor(pipeline: PipelineEngine) {
    super(pipeline)
  }

  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    process.stdout.write('\n=== Webot CLI 模式 ===\n')
    process.stdout.write('输入消息（支持 #save/#discuss/#quote + URL/文本）\n')
    process.stdout.write('输入 exit 退出\n\n')

    this.rl.on('line', async (line) => {
      const text = line.trim()
      if (!text) return
      if (text.toLowerCase() === 'exit') {
        await this.stop()
        return
      }

      const raw: RawMessage = {
        eventId: generateId(),
        source: 'cli',
        rawText: text,
        receivedAt: new Date(),
      }

      try {
        await this.pipeline.execute(raw, this.responder)
      } catch (error) {
        log.error({ error: String(error) }, 'CLI 处理错误')
      }
    })

    this.rl.on('close', () => {
      log.info('CLI 已关闭')
    })
  }

  async stop(): Promise<void> {
    this.rl?.close()
    log.info('CLI 适配器已停止')
    process.exit(0)
  }
}
