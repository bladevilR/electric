# OpenScreen 产品演示录制流程（替代 DOM 硬缩放）

## 已安装

- 应用：`/Applications/Openscreen.app`（v1.5.0 arm64）
- DMG 备份：`output/video/tools/Openscreen-Mac-arm64.dmg`
- 演示入口：`http://127.0.0.1:5210/?demo=settled`（需先起本地服务）

## 为什么换路径

手写 `#workbenchRoot` CSS `scale` 会在金额英雄镜头裁出大块空白（如第 47 秒）。  
**OpenScreen** 在整屏视频上做光标跟随 zoom，不破坏布局。

## 推荐用法（出片）

### A. 你手动用 OpenScreen（最佳运镜）

1. 起服务：
   ```bash
   cd /Users/r/Documents/electric/trading-ai-system
   node server.mjs --port 5210
   ```
2. 浏览器打开全屏：`http://127.0.0.1:5210/?demo=settled`
3. 打开 **Openscreen** → 选窗口/屏幕 → 开 **Auto Zoom**
4. 按业务顺序点：申报总览 → 展开节约测算 → 数据校验 → 曲线 → 建议 → 证据 → 审计 → 策略进化
5. 停录后在 OpenScreen 里调 zoom 深度/时长，导出 MP4 到：
   `output/video/电力交易AI-智能交易副驾驶-参赛版.mp4`

### B. 自动化干净底片（无 DOM 缩放，给 OpenScreen 重录时对照）

```bash
cd /Users/r/Documents/electric/trading-ai-system
# 禁止 CSS 运镜，只保留光标+高亮+旁白对齐
LOCAL_DEMO_DISABLE_CAMERA=1 node recording/local/produce-video.mjs --stage record --port 5210
```

得到的 raw 是**不空推**的全页录屏，可作旁白时间轴；运镜仍建议在 OpenScreen 里做。

## 一键拉起

```bash
bash recording/local/open-openscreen-demo.sh
```
