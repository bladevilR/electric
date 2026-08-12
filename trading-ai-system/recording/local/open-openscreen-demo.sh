#!/usr/bin/env bash
# 拉起：本地 settled 演示 + OpenScreen（手动点录，Auto Zoom 跟鼠标）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${PORT:-5210}"
URL="http://127.0.0.1:${PORT}/?demo=settled"

cd "$ROOT"
if ! curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  echo "启动 trading-ai-system @ ${PORT} …"
  node server.mjs --port "$PORT" >/tmp/trading-ai-5210.log 2>&1 &
  for i in $(seq 1 40); do
    curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 && break
    sleep 0.25
  done
fi

echo "打开演示页：$URL"
open "$URL"
if [ -d /Applications/Openscreen.app ]; then
  open -a Openscreen
  echo "已打开 Openscreen.app — 请选择浏览器窗口并开启 Auto Zoom 后开始录制。"
else
  echo "未找到 /Applications/Openscreen.app，请先安装 DMG：output/video/tools/Openscreen-Mac-arm64.dmg"
  exit 1
fi

echo "操作顺序提示：申报总览 → 展开节约测算 → 数据校验 → 曲线 → AI建议 → 证据 → 审计 → 策略进化"
echo "导出到：output/video/电力交易AI-智能交易副驾驶-参赛版.mp4"
