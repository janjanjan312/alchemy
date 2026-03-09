# The Alchemy 炼金术士 - 产品需求文档

## 1. 产品概述 (Product Overview)

### 1.1 产品愿景

打造一款基于荣格分析心理学（Analytical Psychology）的AI深度伴侣。不同于市面上解决表面情绪问题的CBT（认知行为疗法）机器人，Psyche 旨在通过对话、梦的解析和主动想象，协助用户探索无意识，整合阴影与阿尼玛/阿尼姆斯，推动"自性化（Individuation）"进程。

### 1.2 核心价值

- **深度洞察：** 利用 RAG 技术提供专业的荣格理论扩充，而非泛泛的心理安慰。
- **可视化心灵结构：** 将抽象的心理原型（Archetypes）具体化为动态卡片，让用户看见自己的心理地图。
- **个性化整合：** 随着对话深入，AI 会构建用户专属的"心灵模型"，卡片内容随之进化。

### 1.3 目标用户

- 心理学爱好者，特别是对荣格、神话、象征感兴趣的人群。
- 处于人生迷茫期、中年危机，寻求深度自我认知的人。
- 经常做梦，希望解读梦境意义的人。

---

## 2. 信息架构与用户流程 (IA & Flow)

### 2.1 核心架构

APP 主要分为两个一级界面：

1. **The Vessel (容器/对话界面)：** 所有交互发生的场所。
2. **The Mandala (曼陀罗/"我"的界面)：** 心理结构的可视化展示。

### 2.2 关键数据流

用户输入（聊天/梦境） -> AI 分析与 RAG 检索 -> 生成洞察 -> 更新后端"用户心灵模型" -> 刷新前端"原型卡片"内容。

---

## 3. 功能需求详情 (Functional Requirements)

### 模块一：对话界面 (The Vessel)

**设计隐喻：** 一个安全的、神圣的、私密的炼金容器。

#### 1.1 模式选择 (Mode Switcher)

用户进入对话前或对话中可切换模式（当前 3 个可见 Tab + 1 个隐藏），Prompt 策略不同：

**A. 探索 (Free Talk)** — 默认模式

- **场景：** 用户想聊任何话题（生活、工作、关系、情绪、梦境等）。
- **AI 行为：** 有洞察力的对话伙伴，主动给出观察和假设。当话题触及投射或梦境时，自动使用对应的分析方法。
- **开场：** 显示 3 个随机话题推荐（从 15+ 个荣格相关话题池中抽取），用户可点击直接开始。
- **话题池示例：** "我总觉得自己在扮演一个角色""为什么我总是反复爱上同一类型的人？""有些人明明不重要，但我就是特别在意他们的评价"等。

**B. 投射 (Projection Work)**

- **场景：** 用户对某人产生强烈情绪（爱/恨）。
- **AI 行为：** 四阶段推进——① 搞清具体的人和事，指出投射信号 ② 帮用户看到镜像 ③ 觉察落地 ④ 收束。
- **投射判断标准：** 情绪强度与事件不成比例、对特定人反复产生同一强烈感受、讨厌别人身上自己也有的特质、过度理想化。
- **RAG 调用：** 检索荣格全集中关于投射的描述。
- **输出目标：** 识别出投射特质（`[PROJECTION]` 标签），归档到对应原型卡片。

**C. 梦境 (Dream Weaver)**

- **场景：** 用户记录梦境。
- **AI 行为：** 先给出整体解读（梦的结构、核心情感、可能的心理含义），再逐个分析重要意象：
  1. **解读：** 给出意象的象征含义（结合荣格理论和神话原型）。
  2. **验证：** 基于分析提出具体假设让用户验证（非泛泛的"这让你想到什么"）。
  3. **综合：** 结合分析和用户回应，连接到现实生活。
- **字数限制放宽：** 100-150 字（其他模式 60-100 字），`max_tokens` 400（其他模式 200）。

**D. 主动想象 (Active Imagination)** — 暂时隐藏，待完善

- **场景：** 冥想、与无意识形象对话。
- **当前状态：** 代码保留，UI 不显示。

#### 1.2 动态洞察卡片 (Insight Capture)

- 当对话中达成某个深刻认知（Ah-ha moment）时，AI 会在对话流中生成一张小卡片："发现新的阴影特质：控制欲"。
- 用户点击"确认归档"，该特质会被写入"我"的界面的相应卡片背面。

---

### 模块二："我"的界面 (The Mandala)

**设计隐喻：** 曼陀罗结构。中心是"自性（Self）"，周围环绕着原型卡片。

#### 2.1 原型卡片系统 (Archetype Cards)

系统预设 12 张核心原型卡片（初始状态为未解锁）：

- 自性 (The Self) — 心灵的终极核心与完整性
- 阴影 (The Shadow) — 被压抑的黑暗面
- 阿尼玛 (The Anima) — 男性内在的女性意象
- 阿尼姆斯 (The Animus) — 女性内在的男性意象
- 人格面具 (The Persona) — 适应社会的外部角色
- 英雄 (The Hero) — 自我意识的觉醒
- 智慧老人 (The Wise Old Man) — 精神与古老智慧
- 大母神 (The Great Mother) — 生命的源头，滋养与吞噬的双重性
- 永恒少年 (The Puer Aeternus) — 永恒青春与潜能
- 捣蛋鬼 (The Trickster) — 混乱与无序的化身
- 圣童 (The Child) — 新开端与无限潜能
- 父亲 (The Father) — 权威、秩序与传统

**卡片交互逻辑：**

**正面（理论层 - Static）：**
- 插画（当前使用 Unsplash 照片，计划替换为塔罗牌风格原型插画）。
- 原型的中文描述。
- 有新洞察时显示"金丝磨砂"风格的"新洞察"徽章。

**背面（个人层 - Dynamic）：**
- **我的显化：** AI 根据过往对话总结。例如："在你的职场关系中，阴影常表现为'对愚蠢的零容忍'。"
- **状态标识：** 已解锁/未解锁（替代原 integration_score），卡片正面显示"新洞察"徽章。
- **每日指引：** AI 生成的行动建议。例如："今天尝试观察一下，当你感到愤怒时，是因为对方触碰了你那个'想要完美'的部分吗？"

**动作按钮：**
- **"与它对话"：** 点击后，直接跳转回对话界面。此时 AI 的 Persona 切换为该原型的人格。（例如：以阿尼玛的口吻与用户对话，语气可能是诱惑的、情绪化的或指引的）。

#### 2.2 个人词典 (Symbol Dictionary)

- 自动收集用户在解梦过程中确认的个人象征。
- 例：`{ "蛇": "智慧与恐惧的混合体", "大海": "母亲的怀抱" }`。
- **作用：** AI 在未来的对话中，会优先引用这些定义，保持上下文一致性。

---

## 4. 后端与 AI 架构 (Technical Architecture)

### 4.1 RAG 系统（已实现）

#### 知识库

- **来源：** 荣格全集（Collected Works of C.G. Jung）英文 PDF，含多卷
- **总量：** ~13,328 chunks
- **存储：** SQLite `knowledge_chunks` 表（`id`, `source_file`, `title`, `content`, `embedding` BLOB, `chunk_index`, `created_at`）

#### 数据入库流程 (`scripts/ingest-knowledge.ts`)

```
PDF文件 → pdfjs-dist 文本提取 → 语言检测(中/英) → 文本清洗 → 分块 → 批量embedding → SQLite存储
```

- **PDF 解析：** `pdfjs-dist`，基于 Y 坐标换行，跳过前 14 页（front matter）
- **文本清洗：** 英文专用规则，去除 running headers、footnotes、bibliography、index pages、figure lists
- **分块参数：** 英文 800 字符 / 150 overlap，中文 400 字符 / 80 overlap，英文支持句子边界断句
- **Embedding：** 阿里云 DashScope `text-embedding-v3`，1024 维度，batch size 10，单条上限 8000 字符

#### 服务端内存架构 (`server.ts` 启动时加载)

| 组件 | 说明 |
|------|------|
| `knowledgeCache` | chunk 元数据数组（id, title, content） |
| `embeddingMatrix` | 单一 Float32Array 连续内存矩阵（13328 × 1024），所有向量预归一化 |
| `chunkWordSets` | 每个 chunk 的英文单词 Set，用于 O(1) keyword 匹配 |
| `kwDfCache` | keyword → document frequency 缓存（lazy 计算，会话内持久） |

#### 查询管道 (`GET /api/knowledge-search`)

```
用户查询
  │
  ├─ 检测中文？
  │    ├─ 是 → 并行：① embed 原始查询  ② LLM 翻译为英文（ARK DeepSeek v3）
  │    └─ 否 → embed 原始查询
  │
  ▼
单向量 dot product 搜索（预归一化向量 → 纯点积，~400ms / 13K chunks）
  │
  ▼
Partial sort 取 Top 100 候选
  │
  ▼
IDF 加权 keyword boost（从原始 + 翻译查询提取关键词，稀有术语权重更高）
  │
  ▼
重排序 → 过滤 score > 0.3 → 返回 Top N
```

**Hybrid Scoring 公式：** `final_score = cosine_similarity + keyword_boost`
- `keyword_boost = (matched_idf_weight / total_idf_weight) × 0.12`
- IDF = `log(total_chunks / (df + 1))`，稀有术语如 `nigredo`、`transference` 获得更高加权

#### 查询缓存

| 缓存 | TTL | 上限 |
|------|-----|------|
| Embedding 缓存 | 10 分钟 | 200 条 |
| 翻译缓存 | 30 分钟 | 200 条 |

#### 前端集成

- `Vessel.tsx` 发送用户消息前调用 `searchKnowledge(query, 3)` 获取 Top 3 相关 chunks
- 检索结果注入 system prompt：`【专业知识参考】`，指示 AI 自然融入回复，不直接引用
- 危机检测模式下跳过 RAG（`isCrisis ? [] : searchKnowledge(...)`）

### 4.2 LLM 配置（已实现）

- **对话模型：** 火山引擎 ARK API，DeepSeek v3（`deepseek-v3-250324`）
- **Embedding 模型：** 阿里云 DashScope `text-embedding-v3`（1024 维度）
- **翻译：** 复用对话模型，专用 prompt 确保使用精确荣格术语
- **生成参数：** `max_tokens` 默认 200，梦境模式 400

### 4.2.1 AI 人设与 Prompt 策略（已实现）

**人设定位：** 荣格取向的心理分析师，直觉敏锐、温暖但直接。主动给出观察和假设，让用户验证——不是被动的倾听者。

**核心回复规则：**
- 60-100 字，先给分析再问一个具体问题
- 用好/坏回复示例引导模型风格

**禁止事项（精简为一行）：** 比喻修辞、心理学术语、生活建议、替用户描述状态、复述用户的话

**消息批处理：** 用户可连续发多条消息，1.5 秒无新消息后合并发送给 AI 统一回复。

**去重机制：**
- 同一对话内相同 target+trait 的投射标签不重复显示
- 同一内容的洞察不重复写入数据库

**新洞察状态管理（DB-based）：**
- 归档时 `seen=0`，翻卡查看时调 API 设 `seen=1`
- 前端从 DB 读取 `seen` 字段判断是否显示"新洞察"徽章

#### 记忆系统（已实现）

- **短期记忆：** 当前对话上下文窗口（消息历史）
- **长期记忆：** 两层架构
  - **User Profile：** 长期用户画像（性格特征、核心议题等），持久化存储
  - **Recent Topics：** 最近对话话题摘要，定期更新
- **聊天历史：** SQLite 持久化，按 device ID 隔离

### 4.3 数据结构（SQLite，共 8 张表）

**knowledge_chunks — RAG 知识库：**
```sql
CREATE TABLE knowledge_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  embedding BLOB NOT NULL,        -- Float32Array → Buffer，1024维
  chunk_index INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**archetype_data — 原型卡片个人化数据：**
```sql
CREATE TABLE archetype_data (
  user_id TEXT,
  archetype_id TEXT,
  personal_manifestation TEXT,     -- 洞察记录（多条以换行分隔）
  integration_score INTEGER DEFAULT 0,  -- 历史遗留，前端已用 unlocked 布尔替代
  guidance TEXT,                   -- 每日指引
  updated_at DATETIME,             -- 最近更新时间（通过 ALTER TABLE 迁移添加）
  seen INTEGER DEFAULT 0,          -- 0=有新洞察未读, 1=已读（运行时动态添加）
  PRIMARY KEY (user_id, archetype_id)
);
```

**sessions — 会话管理：**
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**chat_history — 聊天记录：**
```sql
CREATE TABLE chat_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  role TEXT,
  content TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  session_id TEXT,                 -- 迁移添加
  insight_type TEXT,               -- 迁移添加
  insight_content TEXT,            -- 迁移添加
  extras TEXT                      -- 迁移添加，存储 symbol/projection JSON
);
```

**projections — 投射追踪：**
```sql
CREATE TABLE projections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  target TEXT NOT NULL,
  trait TEXT NOT NULL,
  archetype_id TEXT,
  status TEXT DEFAULT 'active',    -- active / integrated
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**symbols — 个人象征词典：**
```sql
CREATE TABLE symbols (
  user_id TEXT,
  term TEXT,
  meaning TEXT,
  PRIMARY KEY (user_id, term)
);
```

**session_summaries — 会话摘要（短期记忆）：**
```sql
CREATE TABLE session_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**user_profiles — 用户画像（长期记忆）：**
```sql
CREATE TABLE user_profiles (
  user_id TEXT PRIMARY KEY,
  core_patterns TEXT DEFAULT '',       -- 核心模式
  shadow_themes TEXT DEFAULT '',       -- 阴影主题
  recurring_symbols TEXT DEFAULT '',   -- 反复象征
  growth_trajectory TEXT DEFAULT '',   -- 成长轨迹
  summary_count INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 5. UI/UX 设计规范 (Design Guidelines)

- **色调：** 深色模式为主（Dark Mode First）。黑底 + 白金（主调），"金丝磨砂"风格强调色用于新洞察徽章和更新高亮。
- **字体：** 衬线体（Serif），体现经典、文学感。
- **动效：** 缓慢的、呼吸感的。卡片翻转使用 Framer Motion (`motion/react`)。
- **声音（未实现）：** 背景白噪音（雨声、壁炉声），按键音效采用类似木头或石头的自然材质声。

---

## 6. 风险与对策

1. **风险：** 用户陷入严重的心理创伤或精神危机。
   - **对策：** 设置安全围栏（Guardrails）。当检测到自杀、自残、重度抑郁关键词时，AI 强制跳出免责声明，并提供心理援助热线，停止深度分析。

2. **风险：** RAG 检索错误，导致象征解释南辕北辙。
   - **对策：** 在解释前，AI 应使用"可能"、"在某种文化中"等非绝对化语言，并总是询问用户："这一定义是否让你产生了共鸣？"（以用户的主观体验为最终验证）。
