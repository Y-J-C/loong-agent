# 板端验收

本文档定义 `loong-agent` 的板端发布验收流程。

## 文档定位

本文档是 LS2K1000 PAI UDB v1.5 + Node.js v14.16.1 的离线发布验收 profile，保留用于理解历史验收口径和特定离线演示场景。

当前仓库维护规则要求后续不要再处理 `dist`、不要运行 `scripts/pack-release.js` 或 `scripts/pack-release.ps1`，也不要基于 `dist` 包做部署。当前板端验证应优先直接同步源码到 `/home/loongson/loong-agent`，再运行与本次修改相关的最小验证。

因此，下文“发布包”和 `dist` 流程只适用于历史离线验收，不是当前默认部署规则。

## 目标板

- 板卡：Loongson LS2K1000 PAI UDB v1.5
- 运行时：Node.js `v14.16.1`
- 验收部署路径：用户可写目录，例如 `/home/loongson/loong-pi-agent-release-test`

验收过程不得修改系统软件包。

## 历史离线发布包

以下流程只适用于历史离线发布验收。当前维护任务不得默认执行这些命令。

```bash
node scripts/create-offline-demo.js
node scripts/pack-release.js --out dist/loong-agent
```

预期产物：

```text
dist/loong-agent/
dist/loong-agent.tar.gz
```

发布包包含：

- `src/`
- `boards/`
- `kb/`
- `scripts/`
- `docs/`
- `runs/sample-offline-demo.jsonl`
- `runs/sample-offline-demo.html`
- `runs/sample-offline-demo.md`
- `README.md`
- `package.json`
- `.env.example`
- `RELEASE_MANIFEST.json`

发布包不得包含 `.env`、`.git`、API keys、tokens、authorization headers、secrets、credentials 或 passwords。

## 板端安装

将 `dist/loong-agent.tar.gz` 复制到板端，然后只在用户可写目录中执行：

```bash
mkdir -p /home/loongson/loong-pi-agent-release-test
cd /home/loongson/loong-pi-agent-release-test
tar -xzf loong-agent.tar.gz
cd loong-agent
```

不要运行 `npm install`。

## 必需 Smoke 验证

```bash
node -v
node src/index.js compat
node src/index.js diagnose
node scripts/board-smoke.js --full
node src/index.js session latest --html --out runs/board-release-latest.html
```

预期输出文件：

- `runs/board-smoke-report.json`
- `runs/board-smoke-report.md`
- `runs/board-smoke-latest.html`
- `runs/board-release-latest.html`
- `runs/sample-offline-demo.html`

## 可选模型检查

如果有 OpenAI-compatible API key：

```bash
cp .env.example .env
# edit .env in a safe terminal, never paste it into logs
node scripts/board-smoke.js --with-model
```

如果没有 API key，则跳过模型检查，且不应导致验收失败。

## 离线演示

打开这个静态文件即可进行无网络回放：

```text
runs/sample-offline-demo.html
```

它由本地样例 session 生成，不能证明实时 API 或网络可用。

## 禁止操作

不要运行：

```bash
npm install
sudo apt install npm g++
sudo apt full-upgrade
```

验收期间不得修改系统软件包、服务状态、文件属主或板端系统文件。
