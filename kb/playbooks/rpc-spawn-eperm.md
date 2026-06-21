# RPC spawn EPERM 与板端 RPC 通过

## 结论

本地 Codex 沙箱里的 `node scripts/test-rpc.js` 出现 `spawn EPERM`，不能直接判定为板端 RPC 失败。阶段 5 证据显示，修复 `scripts/test-rpc.js` 的清理边界后，本地测试不再挂住但仍因沙箱权限快速失败；同步到龙芯派后，RPC 六个用例全部通过。

## 当前状态

- 本地 Codex 沙箱：RPC 子进程创建路径触发 `spawn EPERM`。
- 本地测试脚本：已修复 mock HTTP server 清理边界，失败时不再挂住。
- 龙芯派板端：`node scripts/test-rpc.js` 六个 RPC cases passed。
- 判断边界：板端 RPC 主链路以板端当前或最近一次板端复测证据为准。

## 历史证据

- `kb/raw/phase5/phase5-local-test-rpc.err` 记录本地 `spawn EPERM`。
- `kb/raw/phase5/phase5-board-test-rpc.out` 记录板端六个 RPC 用例全部 PASS。
- `kb/raw/phase5/phase5-diagnosis-summary.md` 记录修复点、复测结果和待确认项。

## 风险

- 把本地沙箱失败误报为板端失败，会误导 RPC 主链路判断。
- 把历史板端通过误当成当前状态，也可能掩盖后续板端环境变化。
- 如果 mock server 清理边界回退，RPC 测试可能再次表现为长时间不退出。

## 禁止操作

- 不把 `spawn EPERM` 直接写成板端 RPC 不可用。
- 不为了本地 RPC 测试失败而处理 `dist`。
- 不写入 `.env`、token 或模型 API key。
- 不安装 npm、g++ 或升级系统来解释该样例。

## 允许的只读排查

- `node scripts/test-rpc.js`
- `node scripts/test-runtime.js`
- `node scripts/test-knowledge-layer.js`
- `node src/index.js compat`
- `ps -ef | grep -E "test-rpc|src/index.js rpc"`

## 待确认

- 本地 Codex 沙箱的 `spawn EPERM` 是否可通过权限配置放开：待确认。
- 若用户问“当前板端是否仍通过”，必须重新在板端运行 `node scripts/test-rpc.js`，不能只引用阶段 5 历史记录。

## 证据路径

- `kb/raw/phase5/phase5-local-test-rpc.err`
- `kb/raw/phase5/phase5-board-test-rpc.out`
- `kb/raw/phase5/phase5-diagnosis-summary.md`
- `scripts/test-rpc.js`
