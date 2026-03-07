# Webot Agent 架构进化 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 webot 从硬编码指令路由的碎片收集工具进化为自建 Agent 框架的智能 Bot，所有消息走 AI 理解 + 工具选择，现有功能零破坏性包装为 Tool。

**Architecture:** 自建 AgentLoop（ReAct 循环）+ ToolRegistry（运行时热插拔）+ SessionManager（SQLite 多轮对话），使用 Vercel AI SDK 作为 LLM API wrapper。现有 pipeline/processor/extractor/writer/digest 完全保留，被 Tool 包装调用。

**Tech Stack:** TypeScript ESM, Vercel AI SDK (`ai` + `@ai-sdk/anthropic`), better-sqlite3, vitest

**Design doc:** `docs/plans/2026-03-08-agent-evolution-design.md`

---

## Phase 1: Agent 核心框架（MVP）

### Task 1: 安装 Vercel AI SDK 依赖

**Files:**
- Modify: `package.json`

**Step 1: 安装依赖**

```bash
cd K:/AI/webot && npm install ai @ai-sdk/anthropic
```

**Step 2: 验证安装**

```bash
cd K:/AI/webot && npx tsc --noEmit
```

Expected: 零错误（新依赖不影响现有代码）

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: 安装 Vercel AI SDK 依赖 (ai + @ai-sdk/anthropic)"
```

---

### Task 2: Tool 接口和基础类型

**Files:**
- Create: `src/tools/base.ts`

**Step 1: 写测试**

Create `tests/unit/tools/registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { Tool, ToolResult, ToolContext } from '../../../src/tools/base.js'

describe('Tool 接口类型检查', () => {
  it('满足 Tool 接口的对象应可赋值', () => {
    const mockTool: Tool = {
      name: 'test',
      description: '测试工具',
      parameters: {
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input'],
      },
      execute: async () => ({ content: 'ok' }),
    }
    expect(mockTool.name).toBe('test')
    expect(mockTool.parameters).toBeDefined()
  })
})
```

**Step 2: 运行测试确认失败**

```bash
npx vitest run tests/unit/tools/registry.test.ts
```

Expected: FAIL — `src/tools/base.js` 不存在

**Step 3: 实现 `src/tools/base.ts`**

```typescript
// 工具系统基础类型定义
import type { Responder } from '../responder/base.js'

/** 工具执行结果 */
export interface ToolResult {
  /** 返回给 LLM 的结果文本 */
  content: string
  /** 副产物（文件路径、卡片 ID 等） */
  artifacts?: Array<{ type: string; value: string }>
  /** 建议后续轮次升级模型（如 'opus'） */
  upgradeModel?: string
}

/** 工具执行上下文 */
export interface ToolContext {
  /** 当前会话 ID */
  sessionId: string
  /** 飞书 chat ID（或 CLI 标识） */
  chatId: string
  /** 进度反馈 */
  responder: Responder
}

/** 工具接口 — 所有工具必须实现 */
export interface Tool {
  /** 工具唯一标识（如 'save'、'digest'） */
  name: string
  /** 给 LLM 看的功能描述 */
  description: string
  /** 参数 JSON Schema */
  parameters: Record<string, unknown>
  /** 执行工具 */
  execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult>
}

/** LLM tool_use schema 格式（传给 Vercel AI SDK） */
export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}
```

**Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/tools/registry.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/base.ts tests/unit/tools/registry.test.ts
git commit -m "feat(agent): Tool 接口和基础类型定义"
```

---

### Task 3: ToolRegistry 实现

**Files:**
- Create: `src/tools/registry.ts`
- Modify: `tests/unit/tools/registry.test.ts`

**Step 1: 写测试**

在 `tests/unit/tools/registry.test.ts` 追加：

```typescript
import { ToolRegistry } from '../../../src/tools/registry.js'
import type { Tool } from '../../../src/tools/base.js'

/** 创建测试用 mock tool */
function mockTool(name: string): Tool {
  return {
    name,
    description: `${name} 工具`,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ content: `${name} executed` }),
  }
}

describe('ToolRegistry', () => {
  it('注册和获取工具', () => {
    const registry = new ToolRegistry()
    const tool = mockTool('save')
    registry.register(tool)
    expect(registry.get('save')).toBe(tool)
  })

  it('注销工具', () => {
    const registry = new ToolRegistry()
    registry.register(mockTool('save'))
    registry.unregister('save')
    expect(registry.get('save')).toBeUndefined()
  })

  it('getAll 返回所有工具', () => {
    const registry = new ToolRegistry()
    registry.register(mockTool('save'))
    registry.register(mockTool('digest'))
    expect(registry.getAll()).toHaveLength(2)
  })

  it('getDefinitions 转为 LLM schema 格式', () => {
    const registry = new ToolRegistry()
    registry.register(mockTool('save'))
    const defs = registry.getDefinitions()
    expect(defs).toHaveLength(1)
    expect(defs[0]).toEqual({
      name: 'save',
      description: 'save 工具',
      input_schema: { type: 'object', properties: {} },
    })
  })

  it('重复注册覆盖旧工具', () => {
    const registry = new ToolRegistry()
    registry.register(mockTool('save'))
    const newTool = mockTool('save')
    newTool.description = '新版 save'
    registry.register(newTool)
    expect(registry.get('save')?.description).toBe('新版 save')
  })

  it('注销不存在的工具不报错', () => {
    const registry = new ToolRegistry()
    expect(() => registry.unregister('nonexist')).not.toThrow()
  })
})
```

**Step 2: 运行测试确认失败**

```bash
npx vitest run tests/unit/tools/registry.test.ts
```

Expected: FAIL — `src/tools/registry.js` 不存在

**Step 3: 实现 `src/tools/registry.ts`**

```typescript
// 工具注册表 — 运行时注册/注销/查询
import type { Tool, ToolDefinition } from './base.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('tool-registry')

/**
 * 工具注册表 — 管理所有可用工具，支持运行时热插拔
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>()

  /** 注册工具（已存在则覆盖） */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool)
    log.info({ tool: tool.name }, '工具已注册')
  }

  /** 注销工具 */
  unregister(name: string): void {
    this.tools.delete(name)
  }

  /** 按名获取工具 */
  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  /** 获取所有已注册工具 */
  getAll(): Tool[] {
    return [...this.tools.values()]
  }

  /** 转为 LLM tool_use schema 格式 */
  getDefinitions(): ToolDefinition[] {
    return this.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }))
  }
}
```

**Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/tools/registry.test.ts
```

Expected: PASS（6 个测试）

**Step 5: Commit**

```bash
git add src/tools/registry.ts tests/unit/tools/registry.test.ts
git commit -m "feat(agent): ToolRegistry 工具注册表"
```

---

### Task 4: SessionManager — DB 迁移 + Repository

**Files:**
- Modify: `src/db/migrations.ts` — 新增 version 3（sessions 表）
- Create: `src/db/repositories/session-repo.ts`

**Step 1: 写测试**

Create `tests/unit/tools/session.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../../../src/db/migrations.js'
import { SessionRepo } from '../../../src/db/repositories/session-repo.js'

describe('SessionRepo', () => {
  let db: Database.Database
  let repo: SessionRepo

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    repo = new SessionRepo(db)
  })

  afterEach(() => {
    db.close()
  })

  it('getOrCreate 首次创建新 session', () => {
    const session = repo.getOrCreate('chat_123')
    expect(session.id).toBe('chat_123')
    expect(session.messages).toEqual([])
  })

  it('getOrCreate 再次获取返回已有 session', () => {
    const s1 = repo.getOrCreate('chat_123')
    repo.addMessage('chat_123', { role: 'user', content: 'hello' })
    const s2 = repo.getOrCreate('chat_123')
    expect(s2.messages).toHaveLength(1)
  })

  it('addMessage 追加消息', () => {
    repo.getOrCreate('chat_123')
    repo.addMessage('chat_123', { role: 'user', content: 'hi' })
    repo.addMessage('chat_123', { role: 'assistant', content: 'hello' })
    const session = repo.getOrCreate('chat_123')
    expect(session.messages).toHaveLength(2)
    expect(session.messages[0].content).toBe('hi')
  })

  it('clear 清空消息', () => {
    repo.getOrCreate('chat_123')
    repo.addMessage('chat_123', { role: 'user', content: 'hi' })
    repo.clear('chat_123')
    const session = repo.getOrCreate('chat_123')
    expect(session.messages).toEqual([])
  })

  it('getHistory 返回消息数组', () => {
    repo.getOrCreate('chat_123')
    repo.addMessage('chat_123', { role: 'user', content: 'hi' })
    const history = repo.getHistory('chat_123')
    expect(history).toHaveLength(1)
  })
})
```

**Step 2: 运行测试确认失败**

```bash
npx vitest run tests/unit/tools/session.test.ts
```

Expected: FAIL

**Step 3: 新增 DB migration（`src/db/migrations.ts`）**

在 `migrations` 数组末尾追加：

```typescript
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
```

**Step 4: 实现 `src/db/repositories/session-repo.ts`**

```typescript
// Agent 会话持久化
import type Database from 'better-sqlite3'

/** 会话消息 */
export interface SessionMessage {
  role: 'user' | 'assistant' | 'tool_result'
  content: string
  toolUseId?: string
}

/** 会话数据 */
export interface Session {
  id: string
  messages: SessionMessage[]
  createdAt: string
  updatedAt: string
}

/**
 * 会话 Repository — SQLite CRUD
 */
export class SessionRepo {
  constructor(private db: Database.Database) {}

  /** 获取或创建会话 */
  getOrCreate(chatId: string): Session {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(chatId) as
      | { id: string; messages: string; created_at: string; updated_at: string }
      | undefined

    if (row) {
      return {
        id: row.id,
        messages: JSON.parse(row.messages),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    }

    const now = new Date().toISOString()
    this.db.prepare(
      'INSERT INTO sessions (id, messages, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run(chatId, '[]', now, now)

    return { id: chatId, messages: [], createdAt: now, updatedAt: now }
  }

  /** 追加消息 */
  addMessage(chatId: string, message: SessionMessage): void {
    const session = this.getOrCreate(chatId)
    session.messages.push(message)
    this.db.prepare(
      'UPDATE sessions SET messages = ?, updated_at = ? WHERE id = ?',
    ).run(JSON.stringify(session.messages), new Date().toISOString(), chatId)
  }

  /** 获取消息历史 */
  getHistory(chatId: string): SessionMessage[] {
    const session = this.getOrCreate(chatId)
    return session.messages
  }

  /** 清空会话消息 */
  clear(chatId: string): void {
    this.db.prepare(
      'UPDATE sessions SET messages = ?, updated_at = ? WHERE id = ?',
    ).run('[]', new Date().toISOString(), chatId)
  }

  /** 替换全部消息（用于压缩） */
  replaceMessages(chatId: string, messages: SessionMessage[]): void {
    this.db.prepare(
      'UPDATE sessions SET messages = ?, updated_at = ? WHERE id = ?',
    ).run(JSON.stringify(messages), new Date().toISOString(), chatId)
  }
}
```

**Step 5: 运行测试确认通过**

```bash
npx vitest run tests/unit/tools/session.test.ts
```

Expected: PASS（5 个测试）

**Step 6: tsc 编译检查**

```bash
npx tsc --noEmit
```

Expected: 零错误

**Step 7: Commit**

```bash
git add src/db/migrations.ts src/db/repositories/session-repo.ts tests/unit/tools/session.test.ts
git commit -m "feat(agent): SessionManager — sessions 表迁移 + SessionRepo"
```

---

### Task 5: System Prompt 构建器

**Files:**
- Create: `src/agent/system-prompt.ts`

**Step 1: 写测试**

Create `tests/unit/agent/system-prompt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../../../src/agent/system-prompt.js'
import type { ToolDefinition } from '../../../src/tools/base.js'

describe('buildSystemPrompt', () => {
  it('包含身份描述', () => {
    const prompt = buildSystemPrompt([])
    expect(prompt).toContain('Webot')
    expect(prompt).toContain('知识管理')
  })

  it('包含工具摘要', () => {
    const tools: ToolDefinition[] = [
      { name: 'save', description: '保存网页', input_schema: {} },
    ]
    const prompt = buildSystemPrompt(tools)
    expect(prompt).toContain('save')
    expect(prompt).toContain('保存网页')
  })

  it('无工具时仍可构建', () => {
    const prompt = buildSystemPrompt([])
    expect(prompt.length).toBeGreaterThan(50)
  })
})
```

**Step 2: 运行测试确认失败**

```bash
npx vitest run tests/unit/agent/system-prompt.test.ts
```

Expected: FAIL

**Step 3: 实现 `src/agent/system-prompt.ts`**

```typescript
// Agent system prompt 动态构建
import type { ToolDefinition } from '../tools/base.js'

/**
 * 构建 Agent 的 system prompt
 */
export function buildSystemPrompt(tools: ToolDefinition[]): string {
  const toolList = tools.length > 0
    ? tools.map((t) => `- **${t.name}**: ${t.description}`).join('\n')
    : '（暂无工具）'

  return `你是 Webot，一个个人知识管理助手。

## 可用工具

${toolList}

## 行为指引

- 简单任务直接执行，不需要确认
- 复杂或多步任务先简要说明计划再执行
- 不确定用户意图时，直接提问澄清
- 用户发送 URL 时，默认使用 save 工具抓取并生成笔记
- 用户发送 #指令 时，将其视为对应工具的快捷调用
- 回复使用中文，技术术语保留英文
- 保持简洁，避免冗余`
}
```

**Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/agent/system-prompt.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/agent/system-prompt.ts tests/unit/agent/system-prompt.test.ts
git commit -m "feat(agent): system prompt 动态构建器"
```

---

### Task 6: AgentLoop — ReAct 循环核心

**Files:**
- Create: `src/agent/loop.ts`

**Step 1: 写测试**

Create `tests/unit/agent/loop.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { AgentLoop } from '../../../src/agent/loop.js'
import { ToolRegistry } from '../../../src/tools/registry.js'
import type { Tool } from '../../../src/tools/base.js'
import type { SessionRepo } from '../../../src/db/repositories/session-repo.js'

/** Mock SessionRepo */
function mockSessionRepo(): SessionRepo {
  const messages: Array<{ role: string; content: string }> = []
  return {
    getOrCreate: vi.fn().mockReturnValue({ id: 'test', messages, createdAt: '', updatedAt: '' }),
    addMessage: vi.fn((_, msg) => messages.push(msg)),
    getHistory: vi.fn(() => messages),
    clear: vi.fn(),
    replaceMessages: vi.fn(),
  } as unknown as SessionRepo
}

/** Mock Responder */
function mockResponder() {
  return {
    onProgress: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
  }
}

describe('AgentLoop', () => {
  it('应能创建实例', () => {
    const registry = new ToolRegistry()
    const sessionRepo = mockSessionRepo()
    const loop = new AgentLoop(registry, sessionRepo, { apiKey: 'test' })
    expect(loop).toBeDefined()
  })
})
```

注意：AgentLoop 的完整测试需要 mock Vercel AI SDK 的 `generateText`，这在集成测试中验证。单元测试确认实例化和基本结构。

**Step 2: 运行测试确认失败**

```bash
npx vitest run tests/unit/agent/loop.test.ts
```

Expected: FAIL

**Step 3: 实现 `src/agent/loop.ts`**

```typescript
// Agent 核心循环 — ReAct 模式（Reason + Act）
import { generateText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { ToolRegistry } from '../tools/registry.js'
import type { SessionRepo, SessionMessage } from '../db/repositories/session-repo.js'
import type { ToolContext } from '../tools/base.js'
import { buildSystemPrompt } from './system-prompt.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('agent-loop')

/** Agent 循环的最大迭代次数 */
const MAX_ITERATIONS = 15

/** AgentLoop 配置 */
export interface AgentLoopConfig {
  apiKey: string
  baseURL?: string
  /** 默认模型（默认 haiku） */
  defaultModel?: string
}

/**
 * Agent 核心循环 — 接收用户输入，通过 ReAct 循环调用工具完成任务
 */
export class AgentLoop {
  private anthropic: ReturnType<typeof createAnthropic>

  constructor(
    private registry: ToolRegistry,
    private sessionRepo: SessionRepo,
    private config: AgentLoopConfig,
  ) {
    this.anthropic = createAnthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    })
  }

  /**
   * 执行 Agent 循环
   * @returns Agent 最终的文本回复
   */
  async run(input: string, context: ToolContext): Promise<string> {
    this.sessionRepo.addMessage(context.chatId, { role: 'user', content: input })

    const modelId = this.config.defaultModel ?? 'claude-haiku-4-5-20251001'
    let currentModel = modelId
    let iterations = 0

    // 构建 Vercel AI SDK tools 对象
    const aiTools = this.buildAITools(context)

    while (iterations++ < MAX_ITERATIONS) {
      const history = this.sessionRepo.getHistory(context.chatId)

      log.info({ iteration: iterations, model: currentModel, messageCount: history.length }, 'Agent 循环迭代')

      try {
        const result = await generateText({
          model: this.anthropic(currentModel),
          system: buildSystemPrompt(this.registry.getDefinitions()),
          messages: this.convertMessages(history),
          tools: aiTools,
          maxSteps: 1, // 每次只执行一步，由我们控制循环
        })

        // 有工具调用
        if (result.toolCalls && result.toolCalls.length > 0) {
          for (const toolCall of result.toolCalls) {
            log.info({ tool: toolCall.toolName, iteration: iterations }, '执行工具')

            // 记录 assistant 的 tool_use 消息
            this.sessionRepo.addMessage(context.chatId, {
              role: 'assistant',
              content: `[调用工具 ${toolCall.toolName}]`,
            })

            // 查找并执行工具
            const tool = this.registry.get(toolCall.toolName)
            if (!tool) {
              const errMsg = `未知工具: ${toolCall.toolName}`
              this.sessionRepo.addMessage(context.chatId, { role: 'tool_result', content: errMsg, toolUseId: toolCall.toolCallId })
              continue
            }

            try {
              await context.responder.onProgress({} as never, `正在执行 ${tool.name}...`)
              const toolResult = await tool.execute(toolCall.args as Record<string, unknown>, context)
              this.sessionRepo.addMessage(context.chatId, {
                role: 'tool_result',
                content: toolResult.content,
                toolUseId: toolCall.toolCallId,
              })

              // 工具建议升级模型
              if (toolResult.upgradeModel) {
                currentModel = toolResult.upgradeModel
                log.info({ newModel: currentModel }, '模型已升级')
              }
            } catch (toolError) {
              const errMsg = toolError instanceof Error ? toolError.message : String(toolError)
              log.error({ tool: toolCall.toolName, error: errMsg }, '工具执行失败')
              this.sessionRepo.addMessage(context.chatId, {
                role: 'tool_result',
                content: `工具执行失败: ${errMsg}`,
                toolUseId: toolCall.toolCallId,
              })
            }
          }
          // 继续循环，让 LLM 看到工具结果
          continue
        }

        // 纯文本回复 → 结束循环
        const text = result.text || '（无回复）'
        this.sessionRepo.addMessage(context.chatId, { role: 'assistant', content: text })
        log.info({ iterations, textLength: text.length }, 'Agent 循环结束')
        return text

      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        log.error({ error: errMsg, iteration: iterations }, 'LLM 调用失败')
        return `抱歉，处理时出错: ${errMsg}`
      }
    }

    const maxMsg = `任务步骤过多（超过 ${MAX_ITERATIONS} 轮），已停止执行。`
    this.sessionRepo.addMessage(context.chatId, { role: 'assistant', content: maxMsg })
    return maxMsg
  }

  /** 构建 Vercel AI SDK tools 对象 */
  private buildAITools(context: ToolContext): Record<string, unknown> {
    const tools: Record<string, unknown> = {}
    for (const tool of this.registry.getAll()) {
      tools[tool.name] = {
        description: tool.description,
        parameters: tool.parameters,
      }
    }
    return tools
  }

  /** 将 SessionMessage 转为 Vercel AI SDK messages 格式 */
  private convertMessages(messages: SessionMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
    // 简化转换：tool_result 作为 user 消息传入
    return messages.map((m) => ({
      role: m.role === 'tool_result' ? 'user' as const : m.role as 'user' | 'assistant',
      content: m.content,
    }))
  }
}
```

**注意**：这是初版实现，Vercel AI SDK 的 `tools` 参数格式需要在集成时根据实际 API 调整（可能需要用 `tool()` helper 包装）。具体格式在 Task 9 的 E2E 测试中验证和调整。

**Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/agent/loop.test.ts
```

Expected: PASS

**Step 5: tsc 编译检查**

```bash
npx tsc --noEmit
```

Expected: 零错误

**Step 6: Commit**

```bash
git add src/agent/loop.ts tests/unit/agent/loop.test.ts
git commit -m "feat(agent): AgentLoop ReAct 循环核心实现"
```

---

### Task 7: SaveTool — 包装现有管道

**Files:**
- Create: `src/tools/save.ts`

**Step 1: 写测试**

Create `tests/unit/tools/save.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { SaveTool } from '../../../src/tools/save.js'

describe('SaveTool', () => {
  it('name 为 save', () => {
    const tool = new SaveTool(null as never)
    expect(tool.name).toBe('save')
  })

  it('parameters 包含 url 必填字段', () => {
    const tool = new SaveTool(null as never)
    const params = tool.parameters as { properties: Record<string, unknown>; required: string[] }
    expect(params.properties).toHaveProperty('url')
    expect(params.required).toContain('url')
  })

  it('description 包含关键词', () => {
    const tool = new SaveTool(null as never)
    expect(tool.description).toContain('网页')
    expect(tool.description).toContain('Obsidian')
  })
})
```

**Step 2: 运行测试确认失败**

```bash
npx vitest run tests/unit/tools/save.test.ts
```

**Step 3: 实现 `src/tools/save.ts`**

```typescript
// SaveTool — 包装现有 PipelineEngine，抓取网页生成摘要写入 Obsidian
import type { Tool, ToolResult, ToolContext } from './base.js'
import type { PipelineEngine } from '../pipeline/engine.js'
import type { RawMessage } from '../types/index.js'
import { generateId } from '../utils/id.js'
import { createLogger } from '../utils/logger.js'
import { FeishuResponder } from '../responder/feishu.js'

const log = createLogger('tool-save')

/**
 * SaveTool — 抓取网页内容，生成 AI 摘要，写入 Obsidian 笔记
 */
export class SaveTool implements Tool {
  name = 'save'
  description = '抓取网页内容，生成 AI 摘要和标签，写入 Obsidian 笔记库。当用户分享 URL 或要求保存/收藏某个链接时使用。'
  parameters = {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '要抓取的网页 URL',
      },
      instruction: {
        type: 'string',
        description: '用户的额外指示，如关注重点、标签建议等（可选）',
      },
    },
    required: ['url'],
  }

  constructor(private pipeline: PipelineEngine) {}

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const url = params.url as string
    const instruction = params.instruction as string | undefined

    log.info({ url }, 'SaveTool 执行')

    // 构造 RawMessage，复用现有管道
    const rawText = instruction ? `#save ${instruction} ${url}` : url
    const raw: RawMessage = {
      eventId: generateId(),
      source: 'agent',
      rawText,
      receivedAt: new Date(),
    }

    try {
      const ctx = await this.pipeline.execute(raw, context.responder)

      if (ctx.status === 'completed' && ctx.written) {
        return {
          content: `笔记已保存到 Obsidian:\n- 标题: ${ctx.written.title}\n- 路径: ${ctx.written.filePath}`,
          artifacts: [{ type: 'file', value: ctx.written.filePath }],
        }
      }

      if (ctx.status === 'draft') {
        return {
          content: `已保存为草稿（AI 处理部分失败）:\n- 标题: ${ctx.written?.title ?? '未知'}\n- 路径: ${ctx.written?.filePath ?? '未知'}`,
        }
      }

      return { content: `处理完成但状态异常: ${ctx.status}` }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error({ url, error: msg }, 'SaveTool 执行失败')
      return { content: `保存失败: ${msg}` }
    }
  }
}
```

**Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/tools/save.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/save.ts tests/unit/tools/save.test.ts
git commit -m "feat(agent): SaveTool — 包装现有管道为 Agent 工具"
```

---

### Task 8: 适配器接入 AgentLoop

**Files:**
- Modify: `src/adapters/feishu.ts` — handleMessage 改为调用 AgentLoop
- Modify: `src/adapters/cli.ts` — 同上
- Modify: `src/index.ts` — 初始化 ToolRegistry + AgentLoop 并传入适配器

这是核心接入任务，需要仔细处理。详细改动：

**Step 1: 修改 `src/adapters/feishu.ts`**

- 构造函数新增 `agentLoop: AgentLoop` 参数
- `handleMessage()` 中删除 `#digest` 硬编码拦截
- `handleMessage()` 中 `setImmediate` 内改为调用 `agentLoop.run()`
- Agent 返回的文本通过 responder 发送给用户
- 保留 `handleCardAction()` 不变（reprocess 走现有管道）

**Step 2: 修改 `src/adapters/cli.ts`**

- 构造函数新增 `agentLoop: AgentLoop` 参数
- readline 输入改为调用 `agentLoop.run()`

**Step 3: 修改 `src/index.ts`**

- 导入 ToolRegistry、AgentLoop、SaveTool、SessionRepo
- 初始化 SessionRepo（使用现有 db.db）
- 初始化 ToolRegistry，注册 SaveTool
- 初始化 AgentLoop，传入 registry + sessionRepo + config
- 传给 FeishuAdapter / CliAdapter

**Step 4: tsc 编译验证**

```bash
npx tsc --noEmit
```

Expected: 零错误

**Step 5: vitest 全量测试**

```bash
npx vitest run
```

Expected: 所有现有测试通过（parser/db/pipeline/writer）

**Step 6: Commit**

```bash
git add src/adapters/feishu.ts src/adapters/cli.ts src/index.ts
git commit -m "feat(agent): 适配器接入 AgentLoop — 消息走 Agent 路径"
```

---

### Task 9: E2E 验证 — CLI 模式

**Step 1: 启动 CLI 模式测试**

```bash
cd K:/AI/webot && npx tsx src/index.ts --cli
```

**Step 2: 测试用例**

| 输入 | 期望行为 |
|------|---------|
| `https://example.com` | Agent 识别为 URL → 调用 save 工具 → 写入 Obsidian |
| `帮我保存这个链接 https://example.com` | Agent 理解意图 → 调用 save |
| `你好` | Agent 直接回复（不调用工具） |
| `你能做什么？` | Agent 列出可用工具 |
| `#save https://example.com` | Agent 识别快捷指令 → 调用 save |

**Step 3: 根据测试结果调整**

可能需要调整：
- Vercel AI SDK `tools` 参数格式（`tool()` helper vs raw JSON）
- `convertMessages()` 的消息格式转换
- system prompt 的引导效果

**Step 4: 修复后 Commit**

```bash
git add -A
git commit -m "fix(agent): E2E 验证修复 — CLI 模式 Agent 流程贯通"
```

---

## Phase 2: 现有功能迁移

### Task 10: DigestTool — 包装每日简报

**Files:**
- Create: `src/tools/digest.ts`

包装 `DigestEngine.run()` + `buildDigestCard()` + `writeDigestToObsidian()`。
从 `index.ts` 中提取 `runDigest()` 逻辑到 DigestTool.execute() 内。

---

### Task 11: DiscussTool — 包装深度分析

**Files:**
- Create: `src/tools/discuss.ts`

包装 `pipeline.reprocess(jobId, 'discuss', ...)`。
参数：`{ jobId?: string, url?: string, instruction?: string }`。
如果传 jobId 走 reprocess，如果传 url 走 pipeline.execute + discuss 指令。

---

### Task 12: WebFetchTool — 纯抓取不写入

**Files:**
- Create: `src/tools/web-fetch.ts`

只调用 `extractor.extract()`，返回网页正文给 LLM（不写 Obsidian）。
适用于"帮我看看这个网页说了什么"。

---

### Task 13: 清理旧路由

**Files:**
- Modify: `src/adapters/feishu.ts` — 确认 #digest 拦截已删除
- Modify: `src/index.ts` — 移除独立的 `setDigestHandler` 和 cron `runDigest` 调用，改为 DigestTool 内部处理定时任务

---

### Task 14: Phase 2 全量验证

- `npx tsc --noEmit` 零错误
- `npx vitest run` 全通过
- CLI 模式测试：`#digest`、自然语言"生成简报"、URL + "深度分析"
- 飞书模式部署测试（`pm2 restart webot`）

---

## Phase 3: Obsidian 知识管理

### Task 15: SearchVaultTool — Obsidian 笔记搜索

**Files:**
- Create: `src/tools/search-vault.ts`

实现逻辑：
- 扫描 `OBSIDIAN_VAULT_PATH` 下的 `.md` 文件
- 支持全文搜索（关键词匹配）和标签搜索（frontmatter tags）
- 返回匹配笔记的标题 + 摘要（frontmatter summary）+ 路径

---

### Task 16: ReadNoteTool — 读取指定笔记

**Files:**
- Create: `src/tools/read-note.ts`

参数：`{ path: string }` 或 `{ title: string }`
读取笔记内容返回给 LLM，支持 Agent 关联分析。

---

### Task 17: Phase 3 验证

- CLI 测试："搜索关于 Claude 的笔记"
- CLI 测试："读一下 xxx 笔记的内容"
- CLI 测试："这个链接和我之前收藏的 xxx 有什么关系"（多工具组合）

---

## Phase 4: 扩展能力

### Task 18: WebSearchTool — 网络搜索

**Files:**
- Create: `src/tools/web-search.ts`

复用 Serper API（项目已有 MCP server 配置）或直接 HTTP 调用。

---

### Task 19: CreateNoteTool — 直接创建笔记

**Files:**
- Create: `src/tools/create-note.ts`

参数：`{ title, content, tags }`，直接写 Obsidian（不经过抓取）。
适用于"帮我记录一个想法"、"整理一下我们刚才的讨论"。

---

### Task 20: 复杂多步任务 E2E 验证

测试场景：
- "调研 Vercel AI SDK，整理成笔记" → Agent 调用 web_search → web_fetch 多个页面 → create_note
- "看看这个项目和我之前收藏的 xxx 有什么关系" → save → search_vault → read_note → 回复分析
- "生成今天的简报，然后搜索简报中提到的 xxx" → digest → search_vault

---

## 依赖关系

```
Task 1 (deps) → Task 2 (types) → Task 3 (registry)
                                      ↓
Task 4 (session) → Task 5 (prompt) → Task 6 (loop) → Task 7 (save) → Task 8 (adapter) → Task 9 (E2E)
                                                                           ↓
                                                      Task 10-12 (tools) → Task 13 (cleanup) → Task 14 (verify)
                                                                                                     ↓
                                                                           Task 15-16 (obsidian) → Task 17 (verify)
                                                                                                     ↓
                                                                           Task 18-19 (extend) → Task 20 (verify)
```

Phase 1 内的 Task 1-5 可部分并行（Task 4 与 Task 5 独立）。
Phase 2-4 必须在 Phase 1 完成后开始。
