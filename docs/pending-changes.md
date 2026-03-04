# Webot 待执行变更说明

> 生成时间: 2026-03-03T18:50:00+08:00
> 来源: 4 个 reviewer agent 逐行代码验证 + team 讨论
> 状态: 待用户审核

---

## CHG-20260303-02: Reprocess 替换/新建选项 🔄 进行中

### 原因

用户发现 reprocess 二次处理（深度分析/提取金句/自定义）**默认删除原笔记文件**。例如 save 后点"深度分析"，原 `[save] 文章.md` 被删除，只剩 `[discuss] 文章.md`。用户无法同时保留多个视角的笔记。

### 影响

- 用户无法对同一篇文章保留多个处理版本（如同时保留摘要+深度分析+金句）
- save→discuss→quote 链式操作中，每一步都删除前一步的结果

### 变更内容

**文件 1: `src/responder/feishu.ts`（完成卡片按钮）**

当前：2 个按钮 + 1 个表单
```
[🔍 深度分析]  [💎 提取金句]
[输入自定义需求...]  [发送]
```

变更后：4 个按钮 + 带 select 的表单
```
── 二次处理（新建笔记）──
[🔍 深度分析]  [💎 提取金句]          ← value 增加 mode: 'new'

⚠️ 以下操作将替换原笔记：
[🔄 分析(替换)]  [🔄 金句(替换)]      ← value 增加 mode: 'replace'

── 自定义需求 ──
[选择: 默认新建笔记 ▼]  [输入需求...]  [发送]
                        ↑ select_static, name='mode'
```

- button value 从 `{ jobId, command }` 变为 `{ jobId, command, mode }`
- 替换按钮文字缩短避免手机端截断
- 两行按钮间加 div 文字提示区分含义
- 自定义表单加 select_static 选择模式（v1 无默认选中，用 placeholder 提示）
- `!ctx.isReprocess` 条件**放开** → reprocess 结果也显示按钮（允许链式操作）
- 深度分析按钮（新建+替换）添加 `confirm` 二次确认：提示"将使用 Opus 模型，耗时约 1-2 分钟"
- 替换类按钮的 `confirm` 额外提示"将替换原笔记"

**文件 2: `src/adapters/feishu.ts`（卡片回调处理）**

当前 L200:
```typescript
const { jobId, command } = action.value
await this.pipeline.reprocess(jobId, command, responder, userInput)
```

变更后:
```typescript
const { jobId, command } = action.value
// 按钮直接携带 mode；表单从 form_value 获取；旧卡片兼容默认 replace
const actionValue = action.value as Record<string, string>
const mode = actionValue.mode
  ?? (command === 'custom' ? action.form_value?.mode : undefined)
  ?? 'replace'  // 旧卡片无 mode 字段时保持原行为

await this.pipeline.reprocess(jobId, command, responder, {
  userInput,
  replaceOriginal: mode === 'replace',
})
```

**文件 3: `src/pipeline/engine.ts`（reprocess 方法）**

当前签名 L278-283:
```typescript
async reprocess(jobId, newCommand, responder, userInput?)
```

变更后:
```typescript
interface ReprocessOptions {
  userInput?: string
  replaceOriginal?: boolean  // 默认 true（向后兼容）
}

async reprocess(jobId, newCommand, responder, options?)
```

当前文件删除逻辑 L357-368（**始终删除**）:
```typescript
if (job.result_json) {
  const oldResult = JSON.parse(job.result_json)
  if (oldResult.filePath && ctx.written?.filePath !== oldResult.filePath && existsSync(oldResult.filePath)) {
    unlinkSync(oldResult.filePath)  // ← 始终执行
  }
}
```

变更后（**条件删除 + 保留原路径**）:
```typescript
const replaceOriginal = options?.replaceOriginal ?? true

if (replaceOriginal && job.result_json) {
  // 替换模式：删除原文件（原逻辑不变）
  const oldResult = JSON.parse(job.result_json)
  if (oldResult.filePath && ctx.written?.filePath !== oldResult.filePath && existsSync(oldResult.filePath)) {
    unlinkSync(oldResult.filePath)
  }
}

// 保存结果时记录原文件路径（新建模式下可追溯）
this.jobRepo.saveResult(jobId, JSON.stringify({
  title: ctx.processed.title,
  tags: ctx.processed.tags,
  filePath: ctx.written?.filePath,
  originalFilePath: !replaceOriginal && oldResult?.filePath
    ? (oldResult.originalFilePath ?? oldResult.filePath)
    : undefined,
}))
```

### 变更后的行为

| 场景 | 当前行为 | 变更后行为 |
|------|----------|------------|
| 点击"深度分析" | 删除原 save 笔记，生成 discuss 笔记 | **新建** discuss 笔记，**保留**原 save 笔记 |
| 点击"分析(替换)" | — | 删除原 save 笔记，生成 discuss 笔记（与当前行为一致） |
| 旧卡片按钮（无 mode） | 删除原笔记 | 删除原笔记（向后兼容，默认 replace） |
| reprocess 完成卡片 | 无按钮 | **有按钮**，支持链式操作（discuss→quote→custom） |
| 自定义表单未选择模式 | — | 默认"新建笔记"（placeholder 提示 + 后端 undefined→'new'） |

---

## ~~CHG-20260303-03: P0 安全加固（SSRF + Prompt 注入）~~ ❌ 废弃

**废弃原因**：webot 为个人单用户工具，不存在外部攻击场景。SSRF 和 Prompt 注入风险不适用于此使用场景。（2026-03-04 用户决策）

---

## CHG-20260303-04: P1 稳定性快赢（崩溃恢复 + API 超时）

### 原因

两个低改动量高回报的稳定性问题。S2 并发节流已移除（单用户场景不适用）。

### 影响

**S5 崩溃**：进程在任务 running 时崩溃 → pm2 重启后该任务永远卡在 running，不会被重试。

**A4 超时**：API 挂起（网络/代理故障）→ 管道永久等待，阻塞后续消息处理。

### 变更内容

**S5: `src/pipeline/engine.ts`（新增 init 方法）或 `src/index.ts`**

```typescript
// 启动时恢复卡死任务
recoverStuckJobs() {
  const count = this.jobRepo.resetRunning()  // UPDATE jobs SET status='failed' WHERE status='running'
  if (count > 0) log.info({ count }, '已恢复卡死任务')
}
```

`src/db/repositories/job-repo.ts` 新增:
```typescript
resetRunning(): number {
  const result = this.db.prepare("UPDATE jobs SET status = 'failed' WHERE status = 'running'").run()
  return result.changes
}
```

**A4: `src/processor/claude-client.ts`**

```typescript
// 变更前（构造函数）
this.client = new Anthropic({ apiKey, ... })

// 变更后
this.client = new Anthropic({
  apiKey,
  timeout: 120_000,  // 全局默认 120s 超时
  ...
})
```

或针对 discuss 单独设置更长超时（通过 `stream()` 的 `signal` 参数）。

### 变更后的行为

| 场景 | 当前行为 | 变更后行为 |
|------|----------|------------|
| pm2 重启后 | running 任务永远卡死 | 自动重置为 failed，进入重试队列 |
| API 挂起 2 分钟 | 无限等待 | 120s 超时 → 进入错误处理 → 调度重试 |
| 正常消息处理 | 无影响 | 无影响 |

---

## CHG-20260303-05: P2 UX 快赢（7 项改进 + 移除图片）

### 原因

7 个低成本高价值的用户体验改进 + 移除图片嵌入。U8（discuss confirm）已合并到 CHG-02。

### 影响

用户在使用 webot 时遇到的体验断层：看不到重试状态、路径噪音、标签缺失、错误信息不友好等。

### 变更内容

#### U3: 告知自动重试（`engine.ts` ~5 行）

```typescript
// 变更前（L194-200）
if (jobId) {
  this.jobRepo.scheduleRetry(jobId)
  log.info({ jobId }, '已调度重试')
}
await responder.onError(ctx, error)

// 变更后
if (jobId) {
  this.jobRepo.scheduleRetry(jobId)
  log.info({ jobId }, '已调度重试')
  // 告知用户
  await responder.onProgress(ctx, '处理失败，已自动调度重试，请稍候...')
}
await responder.onError(ctx, error)
```

#### U7: 去重后提示（`engine.ts` ~5 行）

```typescript
// 变更前（L62-67）
if (this.messageRepo.exists(raw.eventId)) {
  log.info({ eventId: raw.eventId }, '消息已处理，跳过')
  ctx.status = 'completed'
  ctx.completedAt = new Date()
  return ctx  // ← 静默返回，用户无反馈
}

// 变更后
if (this.messageRepo.exists(raw.eventId)) {
  log.info({ eventId: raw.eventId }, '消息已处理，跳过')
  await responder.onProgress(ctx, '该消息已处理过，无需重复发送')
  ctx.status = 'completed'
  ctx.completedAt = new Date()
  return ctx
}
```

#### U4: 路径脱敏（`feishu.ts` ~3 行）

```typescript
// 变更前（L69-73）
elements.push({
  tag: 'div',
  text: { tag: 'plain_text', content: `📁 ${filePath}` },
})

// 变更后
const displayPath = filePath.split(/[/\\]/).slice(-2).join('/')  // 只显示 "inbox/[save] 文章.md"
elements.push({
  tag: 'div',
  text: { tag: 'plain_text', content: `📁 ${displayPath}` },
})
```

#### U5: 添加 tags 展示（`feishu.ts` ~5 行）

```typescript
// 变更后：在 summary div 后面添加
const tags = ctx.processed?.tags
if (tags && tags.length > 0) {
  elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: `🏷️ ${tags.map(t => `\`${t}\``).join(' ')}` },
  })
}
```

#### U2: 错误消息友好化（`feishu.ts` ~15 行）

```typescript
// 新增错误消息映射函数
function friendlyError(msg: string): string {
  if (msg.includes('ERR_NAME_NOT_RESOLVED')) return '无法访问该网址，请检查链接是否正确'
  if (msg.includes('net::ERR_')) return '网络连接失败，请稍后重试'
  if (msg.includes('Readability 无法解析')) return '该网页格式不支持自动提取'
  if (msg.includes('HTTP 4')) return '目标网页拒绝访问（可能需要登录）'
  if (msg.includes('HTTP 5')) return '目标网站服务器错误，请稍后重试'
  if (msg.includes('Claude 未返回')) return 'AI 处理异常，已自动调度重试'
  if (msg.includes('timeout') || msg.includes('Timeout')) return '处理超时，已自动调度重试'
  return '处理失败，请稍后重试'
}

// onError 中使用
content: JSON.stringify(this.buildCard('❌ 处理失败', friendlyError(error.message), 'red'))
```

#### F6: frontmatter 补字段（`obsidian-writer.ts` ~5 行）

```typescript
// 变更前（L37-49）
const frontmatter = {
  status: 'inbox',
  source: context.source,
  ...
}

// 变更后：追加字段
const frontmatter = {
  ...
  site_name: context.extracted?.siteName,
  word_count: context.extracted?.content?.length,
}
```

#### IMG: 移除图片嵌入（`obsidian-writer.ts` ~-8 行）

```typescript
// 变更前（L56-61）：嵌入附件图片
if (context.extracted?.images && context.extracted.images.length > 0) {
  await mkdir(this.attachmentDir, { recursive: true })
  body += context.extracted.images
    .map(img => `![[${img}]]`)
    .join('\n') + '\n\n'
}

// 变更后：删除上述代码块（不再嵌入图片）
// 公众号文章包含大量垃圾图片，污染 Obsidian vault + OneDrive 同步
// 用户需要看图时访问原文链接（source_url 已保存在 frontmatter）
```

#### S3: 长文截断（`processor/index.ts` ~5 行）

```typescript
// 变更后（process 方法入口）
const MAX_CHARS: Record<string, number> = { save: 20_000, discuss: 40_000, quote: 20_000, none: 20_000 }
const limit = MAX_CHARS[command.type] ?? 20_000
const contentText = extracted.content.length > limit
  ? extracted.content.slice(0, limit) + '\n\n[内容已截断]'
  : extracted.content
if (extracted.content.length > limit) {
  log.warn({ original: extracted.content.length, truncated: limit }, '内容超长，已截断')
}
```

### 变更后的行为

| 场景 | 当前行为 | 变更后行为 |
|------|----------|------------|
| AI 处理失败 | 卡片显示"处理失败" + 技术堆栈 | 显示"处理失败，已自动调度重试" + 友好消息 |
| 重发相同消息 | 完全静默，无任何反馈 | 回复"该消息已处理过" |
| 完成卡片路径 | `C:\Users\Xiao\OneDrive\...\inbox\[save] 文章.md` | `inbox/[save] 文章.md` |
| 完成卡片标签 | 不展示 | 展示 `🏷️ \`标签1\` \`标签2\` \`标签3\`` |
| frontmatter | 缺 site_name / word_count | 自动填入 |
| 公众号文章图片 | 所有图片下载到附件目录 + 嵌入笔记 | **不再嵌入图片**，看图访问原文链接 |
| 10 万字文章 | 全量送入 API（可能超 token 限制） | 截断到 20K/40K 字符 + 警告日志 |

---

## CHG-20260303-06: P3 UX 进阶（流式进度 + #help + 草稿按钮 + Vision Schema）

### 原因

中等改动量的 UX 和质量提升，解决用户"以为卡死"、"无处求助"、"草稿无法干预"等痛点。

### 影响

**U1**：discuss 耗时 60-120s，卡片停在"AI 处理中..."无变化，用户以为 bot 卡死。

**U6**：新用户不知道有哪些指令，打错指令（如 `#sav`）静默当文本处理。

**U9**：AI 处理失败生成草稿后，草稿卡片没有任何操作入口，用户无法主动重试。

**U10**：消息包含多个 URL 时只处理第一个，其余静默丢弃。

**A5**：`describeImage()` 不用 structured output，依赖 `JSON.parse(rawText)`，模型输出非 JSON 时走 fallback。

### 变更内容

#### U1: 流式进度更新（`claude-client.ts` + `engine.ts` ~20 行）

```typescript
// claude-client.ts discuss() 方法
// 变更前：只等 finalMessage
const response = await stream.finalMessage()

// 变更后：监听流式事件，通过回调更新进度
async discuss(content: string, args?: string, onProgress?: (msg: string) => void): Promise<...> {
  const stream = this.client.messages.stream({ ... })
  const start = Date.now()

  // 定期报告进度
  let lastReport = 0
  stream.on('text', () => {
    const elapsed = Math.round((Date.now() - start) / 1000)
    if (elapsed - lastReport >= 10) {  // 每 10 秒更新一次
      lastReport = elapsed
      onProgress?.(`AI 深度分析中... (${elapsed}s)`)
    }
  })

  const response = await stream.finalMessage()
  ...
}

// engine.ts reprocess() 中传入 progress 回调
ctx.processed = await this.processor.process(ctx.parsed, ctx.extracted, {
  onProgress: (msg) => responder.onProgress(ctx, msg),
})
```

#### U6: #help 指令 + 错误指令提示（`message-parser.ts` + `engine.ts` ~30 行）

```typescript
// message-parser.ts: 扩展指令匹配
const COMMAND_REGEX = /^#(save|discuss|quote|help)\b/i

// engine.ts: help 分支
if (ctx.parsed.command.type === 'help') {
  await responder.onProgress(ctx, [
    '📖 Webot 使用指南：',
    '• 直接发链接 → 自动摘要',
    '• #save <链接> → 保存摘要',
    '• #discuss <链接> → 深度分析（Opus，~2 分钟）',
    '• #quote <链接> → 提取金句',
    '• 发图片 → 图片描述',
    '• #help → 显示本帮助',
  ].join('\n'))
  return ctx
}

// 检测 # 开头但不匹配的情况
if (raw.rawText.startsWith('#') && ctx.parsed.command.type === 'none') {
  await responder.onProgress(ctx, `未知指令。支持: #save #discuss #quote #help`)
}
```

#### U9: 草稿重试按钮（`feishu.ts` ~15 行）

```typescript
// 变更前（L76-81）：草稿只显示文字
if (isDraft) {
  elements.push({ tag: 'div', text: '⚠️ AI 处理失败，已保存为草稿' })
}

// 变更后：草稿卡片添加重试按钮
if (isDraft && ctx.jobId) {
  elements.push({ tag: 'div', text: '⚠️ AI 处理失败，已保存为草稿（系统将自动重试）' })
  elements.push({ tag: 'hr' })
  elements.push({
    tag: 'action',
    actions: [{
      tag: 'button',
      text: { tag: 'plain_text', content: '🔄 立即重试' },
      type: 'primary',
      value: { jobId: ctx.jobId, command: ctx.parsed?.command.type ?? 'save', mode: 'replace' },
    }],
  })
}
```

#### U10: 多 URL 提示（`engine.ts` ~5 行）

```typescript
// 解析后检查是否有多个 URL
const urls = ctx.parsed.content.urls  // 如果 parser 暴露了完整列表
if (urls && urls.length > 1) {
  await responder.onProgress(ctx, `检测到 ${urls.length} 个链接，当前仅处理第一个`)
}
```

#### A5: Vision 改用 structured output（`claude-client.ts` ~10 行）

```typescript
// 变更前：纯文本 → JSON.parse
const stream = this.client.messages.stream({
  model: HAIKU,
  messages: [{ role: 'user', content: [imageBlock, textBlock] }],
})
const rawText = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
const parsed = JSON.parse(rawText)  // ← 不可靠

// 变更后：使用 tool_use
const stream = this.client.messages.stream({
  model: HAIKU,
  messages: [{ role: 'user', content: [imageBlock, textBlock] }],
  tools: [{ name: 'generate_note', description: '生成结构化笔记数据', input_schema: noteSchema }],
  tool_choice: { type: 'tool', name: 'generate_note' },
})
const toolUse = response.content.find(b => b.type === 'tool_use')
return { ...(toolUse.input as NoteSchemaOutput), model: HAIKU }
```

### 变更后的行为

| 场景 | 当前行为 | 变更后行为 |
|------|----------|------------|
| discuss 处理 60s | 卡片停在"AI 处理中..."不动 | 每 10s 更新"AI 深度分析中... (30s)" |
| 发送 `#help` | 当文本处理 | 显示使用指南 |
| 发送 `#sav 链接` | 静默当文本处理 | 提示"未知指令" |
| AI 处理失败 | 草稿卡片无操作入口 | 草稿卡片有"立即重试"按钮 |
| 发送多个链接 | 只处理第一个，其余丢弃 | 处理第一个 + 提示"仅处理第一个" |
| 图片处理 | JSON.parse 可能失败走 fallback | structured output 可靠输出 |

---

## CHG-20260303-07: P4 架构重构（重试机制 + Playwright 合并）

### 原因

两个架构级问题影响数据一致性和资源利用率。A3 图片持久化已移除（不再保存图片到 vault）。

### 影响

**S4 重试孤儿**：每次重试走完整 `execute()` → 新建 message + job → 失败后新 job 也进入重试队列 → **重试指数膨胀**（3 次重试可能产生 9 条记录）。

**A2 资源浪费**：`PlaywrightExtractor` + `WechatExtractor` 各持独立 `Browser` 实例，同时使用时消耗 ~800MB 内存。

### 变更内容

#### S4: 重试机制重构（`engine.ts` ~50 行）

```typescript
// 变更前：retryFailed() 走完整 execute()
const ctx = await this.execute(raw, silentResponder)

// 变更后：直接从缓存恢复，跳过 dedup/parse/extract
async retryFailed(): Promise<number> {
  for (const job of retryableJobs) {
    // 从缓存恢复抓取内容
    const cachedExtracted = this.jobRepo.getExtracted(job.id)
    if (!cachedExtracted) {
      // 无缓存时仍走完整流程（兼容旧数据）
      await this.executeRetryFull(job, msg)
      continue
    }

    // 直接从 AI 处理阶段继续
    const ctx = createContext(raw)
    ctx.extracted = JSON.parse(cachedExtracted)
    ctx.parsed = parseMessage(raw)

    // AI → Write → Respond（跳过 dedup + extract）
    ctx.processed = await this.processor.process(ctx.parsed, ctx.extracted)
    ctx.written = await this.writer.write(ctx.processed, ctx)

    // 更新原 job（不创建新记录）
    this.jobRepo.updateStatus(job.id, 'completed', 'respond')
    this.jobRepo.saveResult(job.id, JSON.stringify({ ... }))
  }
}
```

#### A2: Playwright 实例合并（`extractor/` ~60 行）

```typescript
// 新建 src/extractor/browser-pool.ts
class BrowserPool {
  private browser: Browser | null = null

  async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true })
    }
    return this.browser
  }

  async close(): Promise<void> {
    await this.browser?.close()
    this.browser = null
  }
}

// PlaywrightExtractor 和 WechatExtractor 改为接收共享 BrowserPool
constructor(private pool: BrowserPool) {}

async extract(url: string) {
  const browser = await this.pool.getBrowser()
  const context = await browser.newContext()
  // ... 使用 context 而非 this.browser
}
```

### 变更后的行为

| 场景 | 当前行为 | 变更后行为 |
|------|----------|------------|
| 任务失败重试 3 次 | 产生 3 条新 message + 3 条新 job（共 7 条记录） | 复用原 job，0 条新记录 |
| 新 job 也失败 | 新 job 进入重试→指数膨胀 | 不产生新 job，不会膨胀 |
| 同时处理微信+普通 URL | 两个 Chromium 进程 ~800MB | 共享一个进程 ~400MB |

---

## 实施优先级总览

```
P1 ──→ CHG-02 替换/新建按钮 (~40行, 用户已审批, 含 U8 confirm)
   ──→ CHG-04 稳定性快赢   (~11行, 崩溃恢复+API超时)
P2 ──→ CHG-05 UX 快赢      (~45行, 7项UX+移除图片)
P3 ──→ CHG-06 UX 进阶      (~80行, 需要接口变更)
P4 ──→ CHG-07 架构重构      (~110行, 重试机制+Playwright合并)
```

> CHG-03（安全加固）已废弃。P5 功能扩展（F1-F5）未创建变更条目，待前面完成后再规划。
