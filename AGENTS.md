# Agents Notes

## Dist 目录处理约束

后续不要再处理 `E:\Projects\loong-pi-agent\dist` 相关内容，包括：

- 不重建 `dist/loong-agent`
- 不生成 `dist/loong-agent.tar.gz`
- 不跑 `scripts/pack-release.js`
- 不基于 `dist` 包做部署

如果需要部署到龙芯派，改用直接同步源码到 `/home/loongson/loong-pi-agent` 的方式，或者只做本地代码和测试验证。

## Project Memory

### Loong Pi SSH

- Host: `10.18.52.130`
- User: `loongson`
- Port: `52101`
- Password handling: do not store the password in repo files or project memory. Prefer existing SSH key auth or an OS credential manager.
- Test path: `/home/loongson/loong-pi-agent`
