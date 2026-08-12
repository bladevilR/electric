# STATUS — electric / JSPEC 相关

更新时间：2026-08-03（全自动全屏录制 + 裁任务栏）

## 当前成片

`trading-ai-system/output/video/电力交易AI-智能交易副驾驶-参赛版.mp4`

- 全自动：ffmpeg 全屏录 + headed kiosk 点演示 + **裁掉菜单栏/浏览器顶栏/Dock**
- 用户无需操作电脑
- 时长约 1:55 · 1920×1080 H.264
- SHA-256 `8bfdf1df1835d30603746c80c0e53cc6aeb730508d725615ec258d7272752b44`
- 脚本：`recording/local/auto-screen-record-demo.mjs`

## 说明

- 本路径是**真屏幕录制**，不是 DOM scale 空推
- 暂无旁白混音（需另合 Serena 轨）
- 复跑：`node recording/local/auto-screen-record-demo.mjs`（会短暂自动隐藏 Dock）

## 2026-08-03 部署记录（10.97.47.88）

- 发布包：`/home/sysadmin/electric-trading-ai.tar.gz`
- 发布包 SHA-256：`fc68bfb2bf6e8b18bf8a8b16388726c17cac7e9a45fe27ae9cc01ea1d3de2f01`
- 版本目录：`/opt/electric-trading-ai/releases/20260803-1406`
- 当前服务目录：`/opt/electric-trading-ai/current`
- systemd：`electric-trading-ai.service`，状态 `active`，开机启用 `enabled`
- 运行数据：`/var/lib/electric-trading-ai/standard-96.json`，离线演示数据 192 行
- 真实验收证据：H5 SSH 截图 `/Users/r/Documents/发改委/review-ai/output/playwright/remote-api-acceptance.png`；5177 监听 `0.0.0.0`，`/api/health` 为 `ok:true`，摘要 `rowCount=192`，核心 API 与首页静态资源均 HTTP 200
- 当前限制：模型运行时未配置真实 API Key，当前为离线演示数据；业务服务仍只监听 5177，未对外新增端口
- 本机原 5177 演示进程已停止；临时桥接监听已清理。用于当前 H5 控制的 OpenCLI 守护进程保留运行，未将其误判为业务服务停止

## 2026-08-03 DMZ / 外网验收盘点

- 当前 DMZ：`DMZ-HLHT-01`，`172.16.20.233`；Windows Nginx 位于 `D:\nginx-1.31.2`，只监听 `80`
- DMZ → `10.97.47.88:5177`：`PingSucceeded=True`，但 `TcpTestSucceeded=False`
- 88 → `5177`：`electric-node` 正常监听 `0.0.0.0:5177`；主机 `iptables INPUT` 默认 `ACCEPT`，`firewalld` 未运行；本机对 `10.97.47.88:5177/api/health` 返回 `ok:true`
- DMZ → `10.97.47.88:8088`：TCP 连通；但 8088 由现有 Docker `fund-project-government-extranet-gateway` 占用，映射到旧发改委网关，不可直接停用或覆盖
- DMZ 现有 Nginx 根路由保持 `80 → https://10.97.47.88:8088`；未覆盖旧根站点
- 发改委历史做法：转发机 `172.16.216.3` 的 Nginx 监听 `2.32.208.51:18080`，以 `/review-ai/` base-path 反代到 `10.97.47.88` 前端 `5173` / API `8001`；该链路不是当前 DMZ `172.16.20.233` 的现成入口

## 2026-08-03 8088 复用接入结果

- 复用现有 `233:80 → 88:8088` 链路；未申请或新增外部端口，未停用 `fund-project-government-extranet-gateway`
- 88 网关配置备份：`/data/fund-project/gateway/nginx.conf.pre-electric-20260803-1655`
- 新增路径：`/electric/` → 当前服务；`/api/` → 当前服务，均通过网关容器已挂载目录中的 Unix socket 转发到 `127.0.0.1:5177`
- 内部代理：`electric-trading-ai-gateway-proxy.service`，socket `/data/fund-project/frontend/electric-trading-ai.sock`，状态 `active`；TCP 5178 仅绑定 Docker 网桥地址
- 网关 `nginx -t` 通过并已平滑 reload；88 侧 `https://10.97.47.88:8088/electric/` HTTP 200、`/api/health` HTTP 200 且返回 `ok:true`
- DMZ 真实机器 `172.16.20.233` 通过本机 Nginx `http://127.0.0.1/electric/` HTTP 200（803 bytes），`/api/health` HTTP 200（615 bytes）；证据截图：`/Users/r/Documents/发改委/review-ai/output/playwright/dmz-acceptance-result2.png`
- 首次浏览器验收发现发布包漏带 `tools/build-settlement-reference.py`，已按本地源文件 SHA-256 `cb2b467da7369615cb44aa236313b03b39590102fbcc3a9d20b7c5298b4d91dd` 补入当前 release；远端脚本可执行并返回真实汇总，刷新后红色错误提示消失；页面前台证据：`/Users/r/Documents/发改委/review-ai/output/playwright/dmz-app-after-fix.png`
- 当前限制：模型运行时未配置真实 API Key，当前为离线演示数据；需以公网 NAT 的实际域名/地址做最终浏览器验收，不能把 DMZ 本机验收等同于公网 NAT 已验证

## 2026-08-10 Windows 360 浏览器卡首屏修复

- 用户现场现象：技术创新组王莹在 360 浏览器中一直停在“正在核对今日数据……只加载首屏需要的轻量数据”。
- 根因证据：同一代码在 Chrome 中 `/api/workbench` 与后续 4 个核心 API 均 HTTP 200、无控制台错误并进入“AI申报优化”；现场截图停留在 `index.html` 静态占位内容，结合现场此前确认使用 360，定位为兼容模式未执行 ES Module。
- 修复：`start-system.ps1` 在 Windows 上优先显式打开 Microsoft Edge，其次 Google Chrome；`index.html` 增加 `nomodule` 兼容提示，旧浏览器不再无限加载。
- 回归证据：`node --test test/windows-batch-format.test.mjs test/windows-launcher.test.mjs`，7/7 通过；Playwright Chrome 验证现代浏览器进入“AI申报优化”，兼容分支显示 Edge/Chrome 操作提示。
- 全量测试盘点：`node --test test/*.test.mjs` 共 162 项，160 通过；2 项因仓库外部夹具缺失失败（历史 `jspec-capture/.../standard-96.json`、本地结算参考文件），与本次变更无关。
- 浏览器截图证据：`/Users/r/Documents/electric/.codex-artifacts/wangying-browser-fix/chrome-workbench.png`。
- 修复包：`/Users/r/Documents/electric/dist/trading-ai-system-one-minute.zip`，ZIP SHA-256 `7bc67eacfcabeb5fe4926ba0492eb593850909dd94f628361c8fcd8152dc9bc3`，解压自检无错误。
- 包内运行时：Node.js v22.23.2 Windows x64，官方 SHASUMS256 校验值 `0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4`，`includesNodeRuntime: true`。
- 当前门禁：已完成本地代码、构包与 Chrome 验收；尚未在王莹的真实 Windows 机器上重新运行验收，不能宣称现场已恢复。

## 2026-08-11 Windows 旧服务占用 5177 修复

- 现场新证据：王莹已在 Chrome 中复现，Console 明确显示 `vendor/gsap.min.js` 与 `workbench-motion.js` HTTP 404；而 v2 ZIP 内两文件实际存在，说明浏览器仍连接到旧目录启动的 5177 服务。
- 修复：`/api/health` 新增当前服务 PID 与根目录；启动器发现 5177 上已有 `trading-ai-system` 时，先定向结束旧 PID，再从当前解压目录启动。旧版健康接口无 PID 时，Windows 通过 `Get-NetTCPConnection` 获取监听 PID。若端口属于其他应用则拒绝误杀并明确报错。
- 新增回归：启动旧服务后执行当前启动器，验证旧 PID 被结束、当前包新 PID 接管 5177。
- 新鲜验证：`node --test test/windows-launcher.test.mjs test/windows-batch-format.test.mjs`，8/8 通过；v3 ZIP `unzip -t` 无错误。
- v3 修复包：`/Users/r/Documents/electric/dist/电力交易AI-Windows一键启动修复版-v3-20260811.zip`，SHA-256 `6bdbc1a3a96dc31be1b5507827ba767d1a6307084fdcc0cb167b2926ceea5f16`，38 MB，包内包含 `vendor/gsap.min.js`、`workbench-motion.js` 与 Windows Node 运行时。
- 当前门禁：已完成本地进程替换验证和构包校验；尚未在王莹的真实 Windows 机器验收，不能宣称现场已恢复。
