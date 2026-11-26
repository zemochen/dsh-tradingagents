# dsh-tradingagents — Agent 执行契约

> **本文件是仓库的唯一 agent 入口。开始任何工作前必须先读本文件，再读它指向的项目文档。**
> **项目文档目录（唯一事实源）：`~/Documents/knowledge/projects/dsh-tradingagents/`**
> （下文简称 `<DOCS>`；该目录不在本仓库内，路径是本机绝对路径。）

## 0. 强制阅读顺序（每次 Session 开始）

1. 本文件（`AGENTS.md`）。
2. `<DOCS>/index.md` — 文档路由。
3. `<DOCS>/context/project-context.md` — 项目定位与当前真实状态（**当前为插件骨架 + 数据层（5/7 类）+ 宿主 runtime + 快速档流水线 + 三 tab（分析/历史/自选+模拟盘）已接通；三档已真机验收，Stage 10 闭包审计 **PASS**（2026-11-26，`audits/2026-11-26-closure-audit.md`）**）。
4. 按任务类型继续路由：`<DOCS>/context/source-of-truth.md`、`<DOCS>/process/10-stage-workflow.md`，以及任务对应的 owner doc
   （架构类 → `architecture/`；行为/设计类 → `design/`；执行类 → `plans/`）。

未完成上述阅读，**不得**修改任何代码或文档。

## 1. 严格执行原则（硬约束）

1. **文档即契约。** `<DOCS>/` 下的 `requirements/`、`design/`、`architecture/`、`plans/` 是执行依据；实现必须与之一致。
2. **文档先行。** 任何非 trivial 变更，必须先在 `<DOCS>/` 中把需求/设计/计划写清，再动代码。文档没有覆盖的新行为，先补文档。
3. **冲突即停。** 发现文档与代码/实测不一致时：**停止实现**，在 `<DOCS>/logs/` 记录冲突，裁决并更新文档后才继续。禁止两头都改、禁止静默绕过。
4. **工作流是强制的。** 必须遵循 `<DOCS>/process/10-stage-workflow.md`（Stage 0–10）。跳过任何阶段必须在当次 `logs/` 写明理由。
5. **事实必须可核实。** 文档中的路径、命令、版本、行号必须来自实测；无法核实的写「未验证」，不得写成结论，更不得编造。
6. **单点真相。** 本仓库**不复制**项目文档。需要说明时只写指向 `<DOCS>/` 的链接，避免双份事实源漂移（见 `<DOCS>/architecture/decisions/0001-knowledge-base-as-sot.md`）。

## 2. Always Do

- **MUST 每次工作 session 结束写日志**：`<DOCS>/logs/YYYY/MM-DD.md`，格式见 `<DOCS>/logs/README.md`。
  内容必须包含：做了什么、`Files changed`（真实路径）、验证命令与关键输出、遗留问题。
- **MUST 为每个实现任务写执行日志**：`<DOCS>/logs/tasks/<task-name>/<timestamp>.md`，记录任务描述、改动文件、执行的命令、验证结果、遇到的问题。
- **MUST 在验证后给出证据**：跑过的命令、关键输出、失败时的原始报错。禁止只写「已测试通过」。
- **MUST 在非 trivial bug 被发现/修复时写** `<DOCS>/bugs/YYYY-MM-DD-{short-description}.md`（含根因）。
- **MUST 在结构性变更（目录、模块、契约）时同步更新**：`<DOCS>/context/codebase-map.md`、对应的 `architecture/` 页面、`<DOCS>/index.md`。
- **MUST 遵守自主边界**：`<DOCS>/context/ai-autonomy-policy.md`。属「需人类审批」的改动，先停下并说明。
- **MUST 保持 git 干净**：只改本任务预期文件；`git status` 出现预期外文件时先查清来源。
- **MUST 在改动 `client.js` / `index.js` / `locale/` / `package.json` 后运行 `node scripts/check-client.mjs`**（`package.json` 的 `check` 脚本即此命令；本机 DSH 工具 shell 无 npm，**不要**把 `npm run check` 写成硬性验收命令），并把输出贴进当次 `logs/`。GUI 可见行为改动必须附人工验证记录（`<DOCS>/testing/`）。
- **MUST 区分文档归属**：项目管理文档写 `<DOCS>/`；与代码强绑定、需随代码分发的契约/构建证据写仓库 `docs/`（规则见 `<DOCS>/architecture/decisions/0003-repo-docs-split.md`），两处不复制同一份内容。

## 3. Never Do

- **NEVER** 未经明确要求执行 `git commit` / `git push`（本仓库当前 `master` 无提交，首次提交必须由用户发起）。
- **NEVER** 修改密钥、凭据、安全配置，或把 API key 写入仓库、日志、locale、前端产物。
- **NEVER** 让 `src/data/` 以外的层直接发外部数据请求；也 **NEVER** 在 `src/data/` 里写交易决策逻辑（分层见 `<DOCS>/architecture/overview.md`）。
- **NEVER** 用 mock / 编造数据冒充真实数据源结果；数据源不可用必须显式失败并说明。
- **NEVER** 在无 ADR 与人类批准的情况下改变对外契约（`package.json` 的 `dsh` 字段、`engines.dsh`、peerDependencies、工具签名、报告 schema、locale key）。
- **NEVER** 把「推断」写进 `context/`、`requirements/` 或 `architecture/` 而不标注「未验证」。
- **NEVER** 跳过 Stage 5/7/10 的独立审计就宣布任务完成。
- **NEVER** 只改代码不改文档、或只改文档不改代码——两者必须同一 session 对齐。
- **NEVER** 破坏 `client.js` 的 classic-script 形态：顶格 `import`/`export` 会语法错误；`__ModuleLoader__.load` 的 `id` **必须**等于 `package.json` 的 `name`。
- **NEVER** 引入第二份 React 或把 React 打包进产物；host 通过冻结模块表提供 `require('react')`。
- **NEVER** 加入下单、券商凭据或任何能移动资金的能力（Non-Goal，写进 README「Scope boundary」）。

## 4. 验收标准（任务完成前必须全部满足）

- [ ] 变更与 `<DOCS>/requirements/` 或 `<DOCS>/design/` 一致；有偏差已裁决并更新文档。
- [ ] `node scripts/check-client.mjs` 通过（输出已贴进 `logs/`）；服务端改动 `node --check index.js` 通过。
- [ ] 验证命令已执行，输出已记录在 `logs/`；无新增 ERROR / WARNING 级问题。
- [ ] 非 trivial bug 已写入 `bugs/`；可复用教训已写入 `lessons/`。
- [ ] `<DOCS>/context/codebase-map.md` 与真实结构一致（有差异必须修正）。
- [ ] `backlog/` 状态已更新；遗留问题已入列。
- [ ] 本文件第 1 节要求的文档已重读过（结构变更时）。

## 5. 仓库现状（2026-11-26 实测）

| 项 | 事实 |
|---|---|
| Git | 分支 `master`，**无提交**，无 remote；所有文件均未跟踪 |
| 包 | `@local/dsh-tradingagents@0.0.0`，`private: true`，无运行时依赖 / 无 `node_modules` |
| 代码 | **插件骨架 + 数据层 + 宿主 runtime + 三档流水线 + 模拟盘**：`index.js`（Config + `/dsh-tradingagents/api/*` 路由/SSE；`/analyze` 三档（quick/standard/deep））、`client.js`（侧边栏行 + 三 tab：分析接 SSE/报告、历史只读、自选+模拟盘；799 行 < ADR-0004 的 800 行门槛）、`cordis.patch.yml`、`locale/{en,zh}.json`、`icon.svg`、`scripts/{check-client,check-data,test-data,test-pipeline,test-paper,check-report,e2e-cdp,migrate-reports}.mjs`、`src/data/`（5/7 类 + 交易日校验 + latestQuote）、`src/pipeline/`（config/runs/llm/stages/roles/prompts/verdict/report/paper/watchlist）、`docs/`、`README.md` |
| 业务代码 | `src/data/`（5/7 类 + 交易日校验，19 用例）；`src/pipeline/` runtime + 三档编排（quick 8 / standard 18 / deep 22 调用）+ 模拟盘/自选；`client.js` 三 tab 已接；标准/深度档已真机验收（≈6/≈12 分钟） |
| 检查 | `node scripts/check-client.mjs` → 通过（78 keys/en、78 keys/zh）；`node --check index.js` → OK；`node scripts/test-data.mjs` → 19 用例；`node scripts/test-pipeline.mjs` → 20 用例；`node scripts/test-paper.mjs` → 6 用例；`node scripts/check-report.mjs <reports>` → OK（12 份，含迁移）；`e2e-cdp` 模式 api/ui/view/invalid/reconnect/paper/uiwatch/uipaper（真机 pass，需 9222）；`check-data 600519` → 5 类 ok（2026-11-23 实测）；Phase 5 host/UI e2e 真机 pass（2026-11-24）；Phase 4 标准 18/深度 22 调用真机 pass（2026-11-24）；Stage 10 修复后三档重跑 pass，roles 8/16/17（2026-11-26）；**Stage 10 闭包审计四轮后 PASS（2026-11-26，需求 §4 9/9）** |
| 工具链 | node `v24.13.0`、npm `11.6.2`、pnpm 未在本机 PATH（profile 内由 Desktop 提供）、git `2.48.1` |
| 宿主 | DeepSeek Harness Desktop `0.2.2-rc.1`（cordis `4.1.0`） |
| 定位（据 README） | A 股多智能体**研究**插件；面板规划 Analysis / History / Watchlist & paper positions 三 tab |

> 现状如有变化，**先更新 `<DOCS>/context/project-context.md` 与本表**，再继续工作。
> 骨架于 2026-11-11 22:27–22:40 由**并行会话**产出，其归属与正式方向**待用户确认**（见 `<DOCS>/context/project-context.md`）。
> 宿主契约证据：仓库 `docs/plugin-contract.md`、`docs/build-decision.md`（与代码同版本，冲突时以它们为准）。
> 独立实测摘要：`<DOCS>/analysis/2026-11-11-dsh-plugin-anatomy.md`；上游参考：`<DOCS>/analysis/2026-11-11-tradingagents-reference.md`。

## 6. 文档路由速查

| 我要… | 去读 |
|---|---|
| 理解项目是什么、当前状态 | `<DOCS>/context/project-context.md` |
| 知道冲突时以谁为准 | `<DOCS>/context/source-of-truth.md` |
| 知道文件放哪、怎么命名 | `<DOCS>/context/conventions.md` |
| 知道目录职责 | `<DOCS>/context/codebase-map.md` |
| 搭环境 / 跑验证 | `<DOCS>/context/development.md`（`node scripts/check-client.mjs`、`node --check index.js`） |
| 查宿主插件契约 | 仓库 `docs/plugin-contract.md`、`docs/build-decision.md` |
| 判断能否自主改 | `<DOCS>/context/ai-autonomy-policy.md` |
| 改代码前看边界 | `<DOCS>/architecture/overview.md`、`<DOCS>/architecture/api.md` |
| 做设计 | `<DOCS>/design/README.md` |
| 执行任务 / 走流程 | `<DOCS>/process/10-stage-workflow.md` |
| 写计划 | `<DOCS>/plans/README.md` |
| 记日志 / bug / 教训 | `<DOCS>/logs/README.md`、`<DOCS>/bugs/README.md`、`<DOCS>/lessons/README.md` |
| 发布 | `<DOCS>/process/deployment.md` |

## 7. 违规判定

出现以下任一情形，视为**任务未完成**，必须回退并补齐：

- 未读文档就改代码；
- 改完不留日志 / 不更新受影响的文档；
- 用未核实的事实或 mock 数据产出结论；
- 跳过审计门直接宣布完成；
- 文档与代码存在已知冲突却未记录。
