# Webot Agent 架构进化设计

> **创建时间**: 2026-03-08T04:27:00+08:00
> **状态**: 设计完成，待实施
> **灵感来源**: Claude-to-IM-skill / OpenClaw / HKUDS/nanobot / Vercel AI SDK

---

## 一、背景与目标

### 现状问题

Webot 当前是一个**硬编码指令路由**的碎片收集工具：

- `message-parser.ts` 用正则匹配 `#save/#discuss/#quote/#help/#digest` 五个固定指令
- `#digest` 在飞书适配器中硬编码 if 拦截，绕过管道
- 管道是固定六阶段流水线（解析→去重→抓取→AI处理→写入→响应）
- 新增功能必须改 parser + adapter + pipeline，耦合度高，可扩展性低

### 进化目标

将 webot 从「碎片收集工具」进化为「可响应任务的 Agent Bot」：

- **自然语言入口** — 不再依赖 `#指令`，用户说什么 AI 理解什么
- **AI 自主决策** — LLM 根据用户意图自主选择调用哪些工具
- **技能可插拔** — 新增能力只需注册一个 Tool，不改任何现有代码
- **运行时热插拔** — ToolRegistry 支持运行时增删工具
- **现有功能保留** — 碎片收集和每日简报作为工具继续存在

---

## 二、研究基础

### 2.1 调研项目

| 项目 | Stars | 核心模式 | 关键借鉴 |
|------|-------|---------|---------|
| OpenClaw | 275k | 单进程 Gateway + Pi Agent | SKILL.md 即技能、不做意图分类交给 LLM |
| HKUDS/nanobot | 30k | ReAct 循环 + ToolRegistry + MessageBus | Tool 基类 + 注册表、Session JSONL、子 Agent |
| Claude-to-IM-skill | 484 | DI + 策略 + SSE | 权限 Promise 挂起、多平台适配器抽象 |
| Vercel AI SDK | 2.8M/周下载 | generateText + tool() + stopWhen | 最轻量 Agent loop wrapper、prepareStep 动态控制 |

### 2.2 关键共识

所有成熟项目都**不做传统意图分类**，而是把工具列表给 LLM，让 LLM 自己决定调用什么。这大幅简化了架构。

---

## 三、架构设计

### 3.1 整体架构

```
所有消息 → Adapter（现有，改动极小）
              ↓
          AgentLoop（新增，ReAct 循环）
              ↓
          Haiku: 理解意图 + 选择工具
              ↓
          ToolRegistry.get(toolName)
              ↓
          Tool.execute(params, context)
          ├── SaveTool      → 现有 PipelineEngine
          ├── DiscussTool   → 现有 pipeline.reprocess()
          ├── DigestTool    → 现有 DigestEngine
          ├── SearchVaultTool → 新增，Obsidian 搜索
          ├── WebFetchTool   → 复用 extractor
          ├── WebSearchTool  → 新增，网络搜索
          └── ...            → 未来扩展
              ↓
          需要深度分析？ → 升级 Opus 继续循环
              ↓
          Responder（现有飞书卡片/CLI，不变）
```

### 3.2 核心原则

1. **全走 Agent** — 每条消息都经过 LLM 理解，充分利用 AI 能力
2. **分层模型** — Haiku 做意图理解和简单任务（~0.5s），Opus 做深度分析
3. **#指令作为快捷提示** — `#save` 不再是路由关键字，而是告诉 AI "我想 save"，跳过意图理解轮次
4. **现有管道零改动** — pipeline / processor / extractor / writer / digest 完全保留，被 Tool 包装调用

---

## 四、核心组件设计

### 4.1 Tool 接口

```typescript
interface Tool {
  /** 工具唯一标识 */
  name: string
  /** 给 LLM 看的功能描述 */
  description: string
  /** 参数 JSON Schema */
  parameters: Record<string, unknown>
  /** 执行逻辑 */
  execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult>
}

interface ToolResult {
  /** 返回给 LLM 的结果文本 */
  content: string
  /** 副产物（写入的文件路径、卡片 ID 等） */
  artifacts?: Array<{ type: string; value: string }>
  /** 建议后续轮次升级模型 */
  upgradeModel?: string
}

interface ToolContext {
  /** 当前会话 ID */
  sessionId: string
  /** 飞书 chat ID */
  chatId: string
  /** 进度反馈 */
  responder: Responder
  /** 工具注册表（可访问其他工具，支持组合） */
  registry: ToolRegistry
}
```

### 4.2 ToolRegistry

```typescript
class ToolRegistry {
  private tools = new Map<string, Tool>()

  /** 注册工具（运行时可调用） */
  register(tool: Tool): void

  /** 注销工具（运行时可调用） */
  unregister(name: string): void

  /** 按名获取 */
  get(name: string): Tool | undefined

  /** 全量工具列表 */
  getAll(): Tool[]

  /** 转为 LLM tool_use schema 格式 */
  getDefinitions(): Array<{ name: string; description: string; input_schema: Record<string, unknown> }>
}
```

### 4.3 AgentLoop — ReAct 循环

```typescript
class AgentLoop {
  constructor(
    private registry: ToolRegistry,
    private sessionManager: SessionManager,
  ) {}

  async run(input: string, context: ToolContext): Promise<string> {
    const session = this.sessionManager.getOrCreate(context.chatId)
    session.addMessage({ role: 'user', content: input })

    let model = 'haiku'   // 从轻量模型开始
    let iterations = 0
    const MAX_ITERATIONS = 15

    while (iterations++ < MAX_ITERATIONS) {
      const response = await llm.stream({
        model,
        system: buildSystemPrompt(session),
        messages: session.getHistory(),
        tools: this.registry.getDefinitions(),
      })

      // 纯文本回复 → 结束循环
      if (response.stopReason === 'end_turn') {
        session.addMessage({ role: 'assistant', content: response.text })
        return response.text
      }

      // tool_use → 执行工具 → 结果喂回 → 继续循环
      if (response.stopReason === 'tool_use') {
        for (const toolCall of response.toolCalls) {
          await context.responder.onProgress(`调用 ${toolCall.name}...`)

          const tool = this.registry.get(toolCall.name)
          const result = await tool.execute(toolCall.params, context)

          session.addMessage({
            role: 'tool_result',
            toolUseId: toolCall.id,
            content: result.content,
          })

          // 工具建议升级模型
          if (result.upgradeModel) model = result.upgradeModel
        }
      }
    }

    return '任务步骤过多，已停止执行。'
  }
}
```

**LLM 后端**：使用 Vercel AI SDK（`ai` + `@ai-sdk/anthropic`）作为 API wrapper，简化流式和 tool_use 处理。

### 4.4 SessionManager — 多轮对话

复用现有 SQLite 基础设施，新增 `sessions` 表：

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,            -- chat_id（飞书群/私聊 ID）
  messages TEXT NOT NULL,         -- JSON array of messages
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata TEXT                   -- 会话级上下文
);
```

**会话策略**：

| 事件 | 行为 |
|------|------|
| 首次消息 | 创建新 session，chat_id 为 key |
| 后续消息 | 追加到同一 session，LLM 看到完整历史 |
| `#new` / `#reset` | 清空 session，开始新对话 |
| 消息超过 50 条 | Haiku 自动压缩前 40 条为摘要，保留最近 10 条 |
| 24 小时无活动 | session 标记 inactive（不删除，可恢复） |

现有 `jobs` 表和 `messages` 表保留不变。`sessions` 跟踪对话状态，`jobs` 跟踪任务执行状态，两套系统并行不冲突。

### 4.5 System Prompt 动态组装

每次调用 LLM 时动态组装：

```
[身份]
你是 Webot，一个个人知识管理助手。你可以帮助用户抓取网页、生成摘要、
搜索笔记、生成简报、进行研究调查。

[可用工具]
{registry.getDefinitions() 的自然语言摘要}

[上下文]
当前时间：{ISO timestamp}
用户平台：飞书
Obsidian 笔记库：已连接

[行为指引]
- 简单任务直接执行，不需要确认
- 复杂/多步任务先简要说明计划再执行
- 不确定用户意图时，直接提问
- #指令是快捷方式，等同于用自然语言表达相同意图
```

---

## 五、初始工具集

### 5.1 包装现有能力

| 工具 | 包装对象 | 描述 |
|------|---------|------|
| `save` | PipelineEngine.execute() | 抓取网页内容，生成 AI 摘要，写入 Obsidian |
| `discuss` | PipelineEngine.reprocess() | 对已有笔记进行深度分析 |
| `digest` | DigestEngine.run() | 生成每日技术简报 |
| `web_fetch` | ContentExtractor.extract() | 抓取网页原文返回文本（不写入 Obsidian） |

### 5.2 新增工具

| 工具 | 功能 | 优先级 |
|------|------|--------|
| `search_vault` | 搜索 Obsidian 笔记（全文/标签/frontmatter） | P1 |
| `web_search` | 网络搜索（复用 Serper API） | P2 |
| `read_note` | 读取指定 Obsidian 笔记内容 | P2 |
| `create_note` | 直接创建 Obsidian 笔记（无需抓取网页） | P3 |

---

## 六、迁移策略

### 6.1 零破坏性迁移

- **现有 `src/pipeline/`、`src/processor/`、`src/extractor/`、`src/writer/`、`src/responder/`、`src/digest/` 完全不变**
- 适配器 `handleMessage()` 从 `pipeline.execute()` 改为 `agentLoop.run()`
- `#digest` 硬编码拦截删除 — 现在是 Agent 的一个工具
- `message-parser.ts` 保留（SaveTool 内部仍使用），但不再是入口路由

### 6.2 新增目录结构

```
src/
├── agent/                     ← 新增
│   ├── loop.ts                ← AgentLoop（~100 行）
│   ├── router.ts              ← #指令预处理（~50 行）
│   ├── session.ts             ← SessionManager（~80 行）
│   └── system-prompt.ts       ← 动态 prompt 组装（~60 行）
├── tools/                     ← 新增
│   ├── registry.ts            ← ToolRegistry（~80 行）
│   ├── base.ts                ← Tool/ToolResult/ToolContext 接口（~30 行）
│   ├── save.ts                ← SaveTool
│   ├── discuss.ts             ← DiscussTool
│   ├── digest.ts              ← DigestTool
│   ├── search-vault.ts        ← SearchVaultTool
│   ├── web-fetch.ts           ← WebFetchTool
│   └── web-search.ts          ← WebSearchTool
├── db/repositories/
│   └── session-repo.ts        ← 新增：session CRUD（~80 行）
├── adapters/                  ← 改动极小（~40 行）
├── pipeline/                  ← 不变
├── processor/                 ← 不变
├── extractor/                 ← 不变
├── writer/                    ← 不变
├── responder/                 ← 不变
├── digest/                    ← 不变
└── index.ts                   ← 改动（~30 行，初始化 AgentLoop）
```

### 6.3 改动量估算

| 类别 | 文件数 | 新增行数 | 修改行数 |
|------|--------|---------|---------|
| Agent 核心 | 4 新文件 | ~300 | 0 |
| 工具实现 | 7 新文件 | ~400 | 0 |
| DB 扩展 | 1 新文件 | ~80 | ~10 |
| 适配器 | 2 文件 | 0 | ~40 |
| index.ts | 1 文件 | 0 | ~30 |
| **合计** | **12 新 + 3 改** | **~780** | **~80** |

### 6.4 新增依赖

| 包名 | 用途 |
|------|------|
| `ai` | Vercel AI SDK Core — Agent loop wrapper |
| `@ai-sdk/anthropic` | Anthropic provider for AI SDK |

---

## 七、实施阶段建议

### Phase 1: Agent 核心框架（MVP）
- Tool 接口 + ToolRegistry + AgentLoop + SessionManager
- SaveTool（包装现有管道）
- 适配器接入 AgentLoop
- 验证：发 URL 能通过 Agent → SaveTool 完成收集

### Phase 2: 现有功能迁移
- DiscussTool + DigestTool + WebFetchTool
- 删除 #digest 硬编码拦截
- 验证：所有现有功能通过 Agent 正常工作

### Phase 3: Obsidian 知识管理
- SearchVaultTool + ReadNoteTool
- 验证：能搜索和关联已有笔记

### Phase 4: 扩展能力
- WebSearchTool + CreateNoteTool
- 复杂多步任务验证（如"调研 X 技术并写笔记"）

---

## 八、风险与缓解

| 风险 | 缓解 |
|------|------|
| Haiku 意图理解不够准确 | 保留 #指令快捷方式兜底；积累 few-shot 示例优化 prompt |
| 每条消息多一次 LLM 调用增加成本 | Haiku 成本极低（~$0.001/次）；简单场景 1 轮即结束 |
| Agent 循环失控（无限调用工具） | MAX_ITERATIONS = 15 硬上限；单工具超时保护 |
| 多轮对话 token 膨胀 | 50 条自动压缩；24h 无活动 session inactive |
| 现有管道兼容性 | SaveTool 内部完整复用 pipeline.execute()，不改现有逻辑 |
