# 上下文管理 + 长期记忆 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 防止 session 消息无限膨胀，支持群聊按用户隔离，实现长期记忆（偏好/事实/摘要）。

**Architecture:** 三层记忆 — 滑动窗口短期对话 + 自动压缩摘要 + 长期记忆库。AgentLoop 每次加载最近 20 条消息 + 用户记忆注入 system prompt。MemoryTool 让 Agent 主动存取记忆。

**Tech Stack:** SQLite（memories 表）、Haiku（对话压缩）、gray-matter、vitest

---

## Task 1: DB Migration v4 — memories 表

**Files:**
- Modify: `src/db/migrations.ts`

在 `migrations` 数组末尾追加 v4：

```typescript
{
  version: 4,
  description: '长期记忆 memories 表',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        chat_id TEXT,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_memories_user_type ON memories(user_id, type);
    `)
  },
},
```

验证：`npx tsc --noEmit`

---

## Task 2: MemoryRepo — 记忆 CRUD

**Files:**
- Create: `src/db/repositories/memory-repo.ts`
- Create: `tests/unit/db/memory-repo.test.ts`

### MemoryRepo 接口：

```typescript
export interface Memory {
  id: string
  userId: string
  chatId: string | null
  type: 'preference' | 'fact' | 'summary'
  content: string
  createdAt: string
  updatedAt: string
}

export class MemoryRepo {
  constructor(private db: Database.Database) {}

  /** 存储记忆 */
  save(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Memory

  /** 按用户查询记忆（偏好 + 事实，全量） */
  getUserMemories(userId: string, types?: string[]): Memory[]

  /** 按关键词搜索记忆 */
  search(userId: string, query: string, limit?: number): Memory[]

  /** 获取最近 N 条摘要 */
  getRecentSummaries(userId: string, limit?: number): Memory[]

  /** 删除记忆 */
  delete(id: string): boolean

  /** 按用户统计 */
  countByUser(userId: string): number
}
```

- 使用 `generateId()` 生成 id
- `save()` 用 INSERT OR REPLACE
- `search()` 用 `content LIKE '%query%'`（SQLite 全文搜索太重，先用 LIKE）

### 测试用例（~10 个）：
- save + 查询
- 按 type 过滤
- 关键词搜索
- 最近摘要
- 删除
- 多用户隔离

验证：`npx tsc --noEmit && npx vitest run tests/unit/db/memory-repo.test.ts`

---

## Task 3: ToolContext 扩展 + 适配器传入 userId

**Files:**
- Modify: `src/tools/base.ts` — ToolContext 新增 `userId: string`
- Modify: `src/adapters/feishu.ts` — 提取 sender userId，传入 context
- Modify: `src/adapters/cli.ts` — 传入固定 `userId: 'cli-user'`

### base.ts 变更：

```typescript
export interface ToolContext {
  sessionId: string
  chatId: string
  userId: string      // 新增
  responder: Responder
}
```

### feishu.ts 变更：

`handleMessage()` 从飞书事件提取 sender：
```typescript
const sender = (data as { sender?: { sender_id?: { open_id?: string } } }).sender
const userId = sender?.sender_id?.open_id ?? 'unknown'
```

Agent 模式 context 中传入：
```typescript
const context: ToolContext = {
  sessionId: `${chatId}:${userId}`,  // 群聊按用户隔离
  chatId,
  userId,
  responder,
}
```

### cli.ts 变更：

```typescript
const context: ToolContext = {
  sessionId: 'cli',
  chatId: 'cli',
  userId: 'cli-user',
  responder: this.responder,
}
```

### index.ts 变更：

cron 调用 digestTool 的 context 也需要加 `userId: 'cron'`。

验证：`npx tsc --noEmit`

---

## Task 4: SessionRepo 更新 + 消息时间戳

**Files:**
- Modify: `src/db/repositories/session-repo.ts`

### 变更点：

1. `SessionMessage` 新增可选 `timestamp: string` 字段（用于超时切分判断）
2. `addMessage()` 自动附加 `timestamp`

```typescript
export interface SessionMessage {
  role: 'user' | 'assistant' | 'tool_result' | 'system_summary'
  content: string
  toolUseId?: string
  timestamp?: string  // ISO 时间戳
}
```

`addMessage()` 中：
```typescript
message.timestamp = message.timestamp ?? new Date().toISOString()
```

验证：`npx tsc --noEmit`

---

## Task 5: ContextManager — 压缩 + 超时切分

**Files:**
- Create: `src/agent/context-manager.ts`
- Create: `tests/unit/agent/context-manager.test.ts`

### 核心接口：

```typescript
export interface ContextManagerConfig {
  maxContextMessages: number   // 发给 LLM 的最大消息数，默认 20
  compressThreshold: number    // 触发压缩的消息总数，默认 30
  sessionTimeoutMs: number     // 超时切分阈值，默认 2h
}

export class ContextManager {
  constructor(
    private sessionRepo: SessionRepo,
    private memoryRepo: MemoryRepo,
    private claudeClient: ClaudeClient,  // Haiku 压缩调用
    private config?: Partial<ContextManagerConfig>,
  ) {}

  /**
   * 获取要发给 LLM 的消息（滑动窗口 + 超时切分）
   * 返回处理后的消息列表
   */
  async getContextMessages(sessionId: string, userId: string): Promise<SessionMessage[]>

  /**
   * 压缩旧消息为摘要
   * 内部调用 Haiku 生成摘要 → 替换 session 中的旧消息 → 存入 memories
   */
  async compressIfNeeded(sessionId: string, userId: string): Promise<void>
}
```

### 压缩逻辑：

1. `getContextMessages()`:
   - 获取 session 全部消息
   - 检查最后一条消息的 timestamp，如果距今 > 2h → 调用 `handleSessionTimeout()`
   - 如果消息总数 > compressThreshold → 调用 `compressOldMessages()`
   - 返回最近 maxContextMessages 条（包含头部的 system_summary）

2. `handleSessionTimeout()`:
   - 将全部消息压缩为 summary
   - 存入 memories 表（type: 'summary'）
   - 清空 session

3. `compressOldMessages()`:
   - 取前 N 条（保留最近 10 条不压缩）
   - 调用 Haiku：`请将以下对话历史压缩为一段简洁的摘要（200字以内）...`
   - 替换为 1 条 `role: 'system_summary'` 消息
   - 同时存入 memories

### ClaudeClient 依赖：

复用现有 `ClaudeClient.structuredCall()` 或新增简单的 `compress()` 方法。
也可直接用 `@anthropic-ai/sdk` 做一次简单调用（因为 ContextManager 不需要工具）。

### 测试用例（~8 个）：
- 消息数 < 阈值不压缩
- 消息数 > 阈值触发压缩（mock ClaudeClient）
- 超时切分（模拟 2h 前的最后消息）
- 压缩后 session 消息格式正确
- 摘要写入 memories
- 滑动窗口截取正确

验证：`npx tsc --noEmit && npx vitest run tests/unit/agent/context-manager.test.ts`

---

## Task 6: AgentLoop 集成 ContextManager + 记忆注入

**Files:**
- Modify: `src/agent/loop.ts`
- Modify: `src/agent/system-prompt.ts`

### loop.ts 变更：

构造函数新增 `contextManager` 和 `memoryRepo` 参数：

```typescript
constructor(
  private registry: ToolRegistry,
  private sessionRepo: SessionRepo,
  private config: AgentLoopConfig,
  private contextManager?: ContextManager,
  private memoryRepo?: MemoryRepo,
)
```

`run()` 方法变更：

```typescript
async run(input: string, context: ToolContext): Promise<string> {
  // sessionId 已由适配器设为 chatId:userId
  this.sessionRepo.addMessage(context.sessionId, { role: 'user', content: input })

  // ... 循环内:
  // 替换 getHistory 为 ContextManager
  let history: SessionMessage[]
  if (this.contextManager) {
    await this.contextManager.compressIfNeeded(context.sessionId, context.userId)
    history = await this.contextManager.getContextMessages(context.sessionId, context.userId)
  } else {
    history = this.sessionRepo.getHistory(context.sessionId)
  }

  // system prompt 注入记忆
  let memories: Memory[] = []
  if (this.memoryRepo) {
    memories = this.memoryRepo.getUserMemories(context.userId, ['preference', 'fact'])
    const summaries = this.memoryRepo.getRecentSummaries(context.userId, 5)
    memories = [...memories, ...summaries]
  }
  const system = buildSystemPrompt(this.registry.getDefinitions(), memories)
  // ...
}
```

注意：session 的 `addMessage` / `getHistory` 使用 `context.sessionId`（即 `chatId:userId`）。

### system-prompt.ts 变更：

```typescript
export function buildSystemPrompt(
  tools: ToolDefinition[],
  memories?: Memory[],
): string {
  // ... 现有内容 ...

  // 追加记忆段
  let memorySection = ''
  if (memories && memories.length > 0) {
    const prefs = memories.filter(m => m.type === 'preference')
    const facts = memories.filter(m => m.type === 'fact')
    const summaries = memories.filter(m => m.type === 'summary')

    const parts: string[] = []
    if (prefs.length > 0) {
      parts.push('### 用户偏好\n' + prefs.map(m => `- ${m.content}`).join('\n'))
    }
    if (facts.length > 0) {
      parts.push('### 已知信息\n' + facts.map(m => `- ${m.content}`).join('\n'))
    }
    if (summaries.length > 0) {
      parts.push('### 近期对话摘要\n' + summaries.map(m => `- ${m.content}`).join('\n'))
    }
    memorySection = '\n\n## 用户记忆\n\n' + parts.join('\n\n')
  }

  return basePrompt + memorySection
}
```

验证：`npx tsc --noEmit`

---

## Task 7: MemoryTool — Agent 主动存取记忆

**Files:**
- Create: `src/tools/memory.ts`
- Create: `tests/unit/tools/memory.test.ts`

### 设计：

```typescript
export class MemoryTool implements Tool {
  name = 'memory'
  description = '管理长期记忆。可以保存用户偏好、重要事实，或检索历史记忆。'
  parameters = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['save', 'recall', 'delete'],
        description: '操作类型：save 保存记忆、recall 检索记忆、delete 删除记忆',
      },
      content: {
        type: 'string',
        description: 'save 时为记忆内容，recall 时为搜索关键词（可选），delete 时为记忆 ID',
      },
      type: {
        type: 'string',
        enum: ['preference', 'fact'],
        description: '记忆类型（仅 save 时有效，默认 fact）',
      },
    },
    required: ['action'],
  }

  constructor(private memoryRepo: MemoryRepo) {}

  async execute(params, context): Promise<ToolResult> {
    switch (action) {
      case 'save':
        // 存储记忆，userId 从 context 取
        break
      case 'recall':
        // 搜索记忆，无 content 时返回最近 10 条
        break
      case 'delete':
        // 删除指定 ID 的记忆
        break
    }
  }
}
```

### 测试用例（~10 个）：
- save preference
- save fact（默认）
- save 缺少 content 报错
- recall 有关键词
- recall 无关键词返回最近
- recall 无结果
- delete 成功
- delete 不存在的 ID
- 不同 userId 隔离

验证：`npx tsc --noEmit && npx vitest run tests/unit/tools/memory.test.ts`

---

## Task 8: 集成注册 + index.ts

**Files:**
- Modify: `src/index.ts`

### 变更：

```typescript
import { MemoryRepo } from './db/repositories/memory-repo.js'
import { MemoryTool } from './tools/memory.js'
import { ContextManager } from './agent/context-manager.js'

// ... 在 main() 中:
const memoryRepo = new MemoryRepo(db.db)

// 注册 MemoryTool
toolRegistry.register(new MemoryTool(memoryRepo))

// 创建 ContextManager
const contextManager = new ContextManager(sessionRepo, memoryRepo, processor.getClaudeClient())

// AgentLoop 传入新参数
const agentLoop = new AgentLoop(toolRegistry, sessionRepo, {
  apiKey: config.anthropicApiKey,
  baseURL: config.anthropicBaseUrl || undefined,
}, contextManager, memoryRepo)
```

cron digestTool context 加 `userId: 'cron'`。

验证：`npx tsc --noEmit`

---

## Task 9: 全量验证

**验证项：**

1. `npx tsc --noEmit` — 零错误
2. `npx vitest run` — 全部通过
3. CLI E2E:
   - 启动确认 9 个工具注册（含 memory）
   - "记住我是前端工程师" → Agent 调用 memory(save)
   - "我的偏好是什么" → Agent 调用 memory(recall)
4. 压缩逻辑验证（单测覆盖）

---

## 依赖关系

```
Task 1 (migration) → Task 2 (MemoryRepo)
                            ↓
Task 3 (ToolContext) → Task 4 (SessionRepo) → Task 5 (ContextManager) → Task 6 (AgentLoop)
                                                                              ↓
                                                       Task 7 (MemoryTool) → Task 8 (集成) → Task 9 (验证)
```

Task 1-4 可部分并行（Task 1+2 与 Task 3+4 独立）。
Task 5 依赖 Task 2+4。Task 6 依赖 Task 5。Task 7 依赖 Task 2+3。Task 8 依赖全部。
