# Alchemy 开发追踪

## 未实现功能

### P0 - 核心功能

- [x] ~~**RAG 检索增强生成**~~ ✅
  - DashScope text-embedding-v3 向量化（1024 维）
  - SQLite `knowledge_chunks` 表存储 + 内存缓存
  - `knowledge/` 目录存放 PDF/Markdown 知识文件
  - `scripts/ingest-knowledge.ts` 入库脚本（自动分块、embedding、写入 DB）
  - `/api/knowledge-search` 语义检索端点（余弦相似度 Top-K）
  - 检索结果注入 `【专业知识参考】` prompt 块
  - 运行方式：`npx tsx scripts/ingest-knowledge.ts`

### P1 - 重要功能

- [x] ~~**对话历史持久化**~~ ✅
  - sessions 表 + chat_history 扩展（session_id, insight_type/content）
  - 后端 CRUD API（GET/POST sessions, GET/POST messages）
  - 前端自动加载/保存对话，切换模式恢复上次会话
  - "新对话"按钮（+ 号）

- [x] ~~**符号词典 (Symbol Dictionary)**~~ ✅
  - 后端 CRUD API（GET/POST/DELETE symbols）
  - AI 在梦境编织模式自动识别 `[SYMBOL: ...]` 标签
  - 对话中显示绿色确认卡片，用户一键存入词典
  - AI system prompt 注入用户已有符号，后续对话可引用
  - 曼陀罗页面可展开查看词典

- [x] ~~**投射追踪 (Projection Tracking)**~~ ✅
  - 新增 `projections` 表（target, trait, archetype_id, status）
  - 后端 CRUD API（GET/POST/PATCH/DELETE projections）
  - AI 在投射工作模式自动识别 `[PROJECTION: ...]` 标签
  - 对话中显示紫色确认卡片，用户一键归档
  - AI system prompt 注入用户已有投射记录
  - 曼陀罗页面可展开查看活跃投射，支持标记为"已整合"


- [x] ~~**用户识别**~~ ✅
  - 设备 UUID 自动生成（localStorage），无需注册登录
  - 会话侧边栏（历史对话浏览/切换/新建/删除）
  - 懒创建 session（用户说话才保存）
  - 自动清理空 session + 超出上限的旧 session

### P2 - 增强功能

- [x] ~~**安全围栏 (Guardrails)**~~ ✅
  - 检测自杀、自残、重度抑郁等危机关键词
  - 触发时强制展示免责声明 + 心理援助热线
  - 停止深度分析，切换为安全模式

- [x] ~~**长期记忆 (Summary + Profile)**~~ ✅
  - 双层记忆架构：
    - **用户画像**（`user_profiles`）：4 固定维度（核心模式/阴影主题/反复象征/成长轨迹），每 5 条摘要自动合并更新
    - **近期摘要**（`session_summaries`）：每会话 50-80 字，上限 20 条/用户
  - Prompt 分层注入：画像（长期稳定）+ 最近 3 条摘要（短期连续性）
  - AI 自然参考但不直接透露知道这些信息

- [ ] **卡片塔罗牌风格插画**
  - 当前使用 Unsplash 照片
  - 替换为精美的塔罗牌风格原型插画

### P3 - 低优先级

- [ ] **主动想象模式特殊 UI**（Tab 已隐藏，待完善后重新上线）
  - 进入主动想象模式时背景变暗
  - AI 文字输出速度变慢（逐字/呼吸节奏）
  - 建议配合语音输入使用

- [x] ~~**DashScope API Key 迁移到后端**~~ ✅
  - /api/transcribe 代理 HTTP 语音转录
  - /api/asr-ws-url 返回带 token 的 WebSocket 地址
  - 清理所有 VITE_ 前缀敏感变量

- [x] ~~**「与原型对话」完整实现**~~ ✅
  - 12 个原型独立人格 prompt（性格特质 + 说话方式 + 核心关切）
  - 基于用户个人数据（画像/投射/象征/洞察/摘要）实时拼装 prompt
  - 点击原型卡片 → 第三 tab 出现 → 个人化原型对话
  - `/api/archetype-context` 端点聚合用户数据

- [ ] **Draw the Dream（梦境图像生成）**
  - 在梦境编织模式中，根据梦境描述生成图像
  - 调用图像生成 API，辅助梦境分析

---

## 已完成功能

- [x] 双 Tab 界面（Vessel + Mandala）
- [x] AI 对话（ARK DeepSeek v3，四种模式，后端代理）
- [x] Prompt 体系优化（融入 nightvoyage 精华：回复长度约束、引导哲学、五感沉浸）
- [x] 语音输入（DashScope ASR WebSocket + Web Speech API fallback + HTTP fallback）
- [x] 洞察卡片生成 + 归档到曼陀罗（端到端）
- [x] 原型卡片系统（12 个原型，Unsplash 图片，中文描述）
- [x] 卡片正反面翻转（洞察记录 + 每日指引）
- [x] 卡片排序（已解锁优先，按更新时间排列）
- [x] SQLite 数据库（archetype_data 读写）
- [x] PWA 支持（manifest + Service Worker + 移动端优化）
- [x] 纯移动端布局 + PC 端手机框预览
- [x] 星空动画背景
- [x] API Key 安全（ARK 文本模型已迁移到后端代理）
- [x] Gemini 残留清除
- [x] 对话历史持久化（sessions + chat_history，支持新建/恢复对话）
- [x] 符号词典（AI 自动识别 + 确认卡片 + 曼陀罗查看 + AI 上下文注入）
- [x] 投射追踪（AI 自动识别 + 确认卡片 + 曼陀罗查看 + 状态管理 + AI 上下文注入）
- [x] 用户识别（设备 UUID + 侧边栏 + 懒创建 session + 自动清理）
- [x] 安全围栏（危机关键词检测 + 弹窗热线 + AI 安全模式 prompt）
- [x] 长期记忆（双层架构：用户画像 4 维度 + 近期摘要 + 分层 prompt 注入）
- [x] DashScope API Key 迁移（后端代理 + 清理 VITE_ 前缀变量）
- [x] 与原型对话（12 个人格 prompt + 个人数据拼装 + 第三 tab UI）
- [x] RAG 知识库（DashScope embedding + SQLite 向量存储 + 语义检索 + prompt 注入）
- [x] AI 人设重塑（荣格分析师风格：主动观察、温暖直接、有假设性、禁比喻/术语/建议）
- [x] Prompt 精简与整合（BASE_INSTRUCTION 从 28 行压缩到 10 行，合并禁止规则，加好/坏示例）
- [x] 投射模式 prompt 增强（四阶段推进 + 投射信号判断标准 + 去重）
- [x] 梦境模式 prompt 重构（先整体解读再逐意象分析、假设驱动验证、max_tokens 400）
- [x] 探索模式（新 Tab，默认模式，随机话题推荐，支持梦境/投射分析）
- [x] 主动想象 Tab 隐藏（代码保留，UI 不显示）
- [x] 消息批处理（用户可连续发多条，1.5s 后统一 AI 回复）
- [x] 即时思考气泡 + 自动滚动（用户发送后立即显示"沉思中"）
- [x] 新洞察状态管理（DB `seen` 字段替代 localStorage，归档/翻卡联动）
- [x] "金丝磨砂"视觉风格（新洞察徽章、卡片高亮、投射卡片样式统一）
- [x] 归档按钮反馈优化（已归档 ✓ 状态、防重复点击、投射/洞察文案统一）
- [x] 洞察记录格式化（多条记录换行 + ◆ bullet point）
- [x] integrationScore 移除（改为简单的 unlocked 布尔状态）
- [x] 投射/洞察卡片去重（前端 + 后端双重防重）
