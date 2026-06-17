# Agents Notes

## Dist 目录处理约束

后续不要再处理 `E:\Projects\loong-pi-agent\dist` 相关内容，包括：

- 不重建 `dist/loong-agent`
- 不生成 `dist/loong-agent.tar.gz`
- 不跑 `scripts/pack-release.js`
- 不基于 `dist` 包做部署

如果需要部署到龙芯派，改用直接同步源码到 `/home/loongson/loong-pi-agent` 的方式，或者只做本地代码和测试验证。

## 板端部署与验证要求

每次对仓库文件完成修改后，默认需要把当前源码同步到龙芯派并在板端完成验证。

- 部署方式：直接同步源码到 `/home/loongson/loong-pi-agent`。
- 同步时仍然不得处理 `dist`，也不得把 `.git`、`node_modules`、`.env`、`runs` 等目录或敏感文件同步到板端。
- 同步后至少运行与本次修改相关的验证命令；如果修改涉及知识层或 runtime，优先运行：
  - `node scripts/test-knowledge-layer.js`
  - `node scripts/test-runtime.js`
- 如果用户明确要求“只做本地修改 / 不部署 / 不连板端”，以用户当次要求为准，并在结果中说明未做板端验证。
- 板端验证不得写入密钥、token、`.env` 或其他敏感信息。

## Project Memory

### Loong Pi SSH

- Host: `10.18.52.130`
- User: `loongson`
- Port: `52101`
- Password handling: do not store the password in repo files or project memory. Prefer existing SSH key auth or an OS credential manager.
- Test path: `/home/loongson/loong-pi-agent`
