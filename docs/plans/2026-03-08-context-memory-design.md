# 上下文管理 + 长期记忆 设计文档

> 创建时间: 2026-03-08
> 状态: 待实施

## 背景

webot 当前 session 机制的问题：
1. 飞书私聊/群聊的 chatId 固定不变，messages 无限累积，最终超出 LLM 上下文限制
2. 群聊场景所有用户共享同一个 chatId，对话上下文混合
3. 没有长期记忆，跨对话的用户偏好/事实无法保留

即将部署到公司群，多人使用会加速问题暴露。

## 设计目标

- 防止上下文爆炸（滑动窗口 + 自动压缩）
- 群聊按用户隔离对话上下文
- 长期记忆：用户偏好、事实、对话摘要
- Agent 可主动存取记忆（MemoryTool）
- 每次对话自动注入相关记忆

## 方案

### 1. 上下文管理

#### 滑动窗口

- `MAX_CONTEXT_MESSAGES = 20`：AgentLoop 每次迭代只发送最近 20 条 messages 给 LLM
- 压缩触发：session 消息总数超过 30 条时，将前 20 条用 Haiku 压缩为一段摘要
- 压缩后的摘要作为一条 `role: 'system_summary'` 消息保留在 session 头部，替换原消息
- 压缩后 session 变为：1 条 summary + 最近 10 条 = 11 条

#### 超时切分

- 上一条消息距今超过 2 小时 → 视为新对话轮次
- 旧消息全部压缩为 summary 存入 memories 表（type: 'summary'）
- session messages 清空，开始新对话

#### Session Key 变更

- 当前：`chatId`
- 改为：`${chatId}:${userId}`
- 群聊中每个用户有独立的对话上下文
- 私聊场景 userId 和 chatId 一一对应，行为不变

### 2. 长期记忆

#### DB Schema（migration v4）

```sql
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  chat_id TEXT,           -- NULL 表示用户全局记忆，非 NULL 表示群级记忆
  type TEXT NOT NULL,     -- 'preference' | 'fact' | 'summary'
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_memories_user ON memories(user_id);
CREATE INDEX idx_memories_type ON memories(user_id, type);
```

#### 记忆类型

| type | 含义 | 来源 | 示例 |
|------|------|------|------|
| preference | 用户偏好 | Agent 主动存储 | "摘要用中文"、"默认加 #work 标签" |
| fact | 事实信息 | Agent 主动存储 | "用户是前端工程师"、"团队在做 xxx 项目" |
| summary | 对话摘要 | 自动压缩生成 | "3月8日：讨论了 AI Agent 架构，保存了 3 篇文章" |

#### MemoryTool

双操作工具：
- `save_memory(content, type?)` — 存储记忆，默认 type=fact
- `recall_memory(query?)` — 按关键词检索记忆，无 query 时返回最近记忆

Agent 通过自然语言触发：
- "记住我喜欢 xxx" → save_memory(type: preference)
- "我之前跟你说过什么" → recall_memory()

#### 自动注入

AgentLoop `run()` 开始时：
1. 从 memories 表查询该 userId 的 preference + fact（全部）
2. 查询最近 5 条 summary
3. 拼接到 system prompt 的「用户记忆」段

### 3. ToolContext 扩展

```typescript
export interface ToolContext {
  sessionId: string    // ${chatId}:${userId}
  chatId: string
  userId: string       // 新增
  responder: Responder
}
```

飞书适配器从消息事件中提取 `sender.sender_id.open_id` 作为 userId。
CLI 模式使用固定值 `'cli-user'`。

### 4. 影响范围

| 模块 | 变更类型 | 说明 |
|------|----------|------|
| `db/migrations.ts` | 修改 | v4: memories 表 |
| `db/repositories/memory-repo.ts` | 新建 | memories CRUD |
| `db/repositories/session-repo.ts` | 修改 | session key 兼容 |
| `agent/loop.ts` | 修改 | 滑动窗口 + 超时切分 + 记忆注入 |
| `agent/context-manager.ts` | 新建 | 压缩逻辑（Haiku 摘要） |
| `agent/system-prompt.ts` | 修改 | 注入用户记忆段 |
| `tools/memory.ts` | 新建 | MemoryTool |
| `tools/base.ts` | 修改 | ToolContext 新增 userId |
| `adapters/feishu.ts` | 修改 | 提取 userId |
| `adapters/cli.ts` | 修改 | 传入固定 userId |
| `index.ts` | 修改 | 注册 MemoryTool |
