# 比赛附件的 macOS 工具链

## 这三个工具是干什么的

- `genai-log-validator`：在提交前校验 `traces.json` / `traces-dynamic.json` 是否符合 OTLP GenAI Trace 格式。
- `information-validator`：校验 `information.json` 的结构、参赛材料声明和动态评测 API 配置。
- `dynamic-evaluation-runner`：从静态 Trace 中生成 C4/E3 动态评测任务；`check` 只生成计划，`run` 会真正调用参赛 API 并产生执行报告。

Windows `.exe` 不能在当前 Apple Silicon Mac 上原生运行。本项目直接调用附件里的 Python 源码，不修改 `/Users/r/Downloads` 中的原始包。

## 本机状态

- 平台：macOS `arm64`
- 隔离环境：`trading-ai-system/.competition-tools/venv`
- Python：`3.14.5`
- 锁定依赖：`pydantic 2.13.4`、`PyYAML 6.0.2`
- 原始附件：`/Users/r/Downloads/智能体运行日志格式校验工具/competition-attachments`

`setup` 会把 `uv` 缓存一并放进 `.competition-tools/`，不依赖用户级 `~/.cache`。这可以避开当前 Mac 上指向未挂载卷的 `~/.cache` 断链。

## 快速命令

在 `/Users/r/Documents/electric/trading-ai-system` 执行：

```bash
npm run competition:setup
npm run competition:doctor
npm run competition:smoke
```

`smoke` 全程不调用参赛 API，会检查：

1. 有效 Trace 正例通过；
2. 非法 Trace 反例被拒绝；
3. `information.json` 示例通过；
4. 动态评测 `check` 能生成 C4/E3 计划。

## 校验自己的参赛文件

```bash
node tools/competition-tools.mjs validate-traces /absolute/path/traces.json --format json

node tools/competition-tools.mjs validate-information /absolute/path/information.json --json

node tools/competition-tools.mjs dynamic-check \
  /absolute/path/information.json \
  /absolute/path/traces.json
```

Trace 校验器也支持多文件、JSONL 和通配符，后续参数会原样传给官方 Python 工具。

`validate-information` 默认只允许本地 JSON。URL 会直接下载内容，CSV/XLSX 批量清单也可能包含网络地址，因此这三类输入必须显式授权：

```bash
node tools/competition-tools.mjs validate-information \
  --allow-network \
  https://example.com/information.json \
  --json
```

## 真正执行动态评测

`dynamic-run` 会联网调用 `information.json` 中的 API，因此必须显式输入命令和报告路径：

```bash
node tools/competition-tools.mjs dynamic-run \
  /absolute/path/information.json \
  /absolute/path/traces.json \
  --output /absolute/path/execution-report.json \
  --timeout 30
```

当前项目已经提供本机 `POST /v1/chat/completions`、自动 OTLP Trace 记录和正式材料构建器。执行 `npm run competition:build-delivery` 会真实启动 Agent、生成静态 Trace、调用官方 runner 完成 3 条动态请求、导出动态 Trace，并且仅在全部门禁通过后发布交付目录。最终上传规则和验收结果见 [competition-final-delivery.md](./competition-final-delivery.md)。

## 可选路径覆盖

```bash
COMPETITION_ATTACHMENTS_DIR=/another/attachments \
COMPETITION_TOOLS_RUNTIME_DIR=/another/runtime \
COMPETITION_BOOTSTRAP_PYTHON=/path/to/python3 \
COMPETITION_UV_BIN=/path/to/uv \
node tools/competition-tools.mjs setup
```

运行时目录 `.competition-tools/` 和 `.competition-runtime/` 已被 Git 忽略。正式文件由构建器放入 `competition-delivery/upload/`，QA 证据放入 `competition-delivery/qa/`。
