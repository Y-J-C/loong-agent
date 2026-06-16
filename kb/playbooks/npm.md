# npm 缺失

## 结论

Node.js runtime 可用，但 `npm` / `npx` 不可用。不能把 Node.js 可用推导为 npm 工作流可用。

## 当前状态

- `node` 版本为 `v14.16.1`。
- `npm` / `npx` 为 missing。
- `npm` 有 apt candidate，但这不等于已安装或可安全安装。

## 历史证据

- `software_stack.md` 记录 Node.js 可用且 npm 缺失。
- `package_management.md` 记录 npm not installed、runtime not found、candidate exists。

## 风险

- npm 依赖规模高，可能引入大量 node-* 包。
- 板端根分区空间有限，不适合默认执行大型依赖安装。

## 禁止操作

- 不默认执行 `npm install`。
- 不默认建议 `sudo apt install npm`。
- 不引入 npm runtime dependency 作为 Loong Pi Agent 必需路径。

## 允许的只读排查

- `node -v`
- `node -p "process.arch"`
- `which npm`
- `npm -v`
- `apt-cache policy npm`

## 待确认

- npm 安装依赖规模、磁盘影响、源状态和长期维护成本。

## 证据路径

- `kb/software_stack.md`
- `kb/compatibility_matrix.md`
- `kb/loongson-2k1000-board-kb-preview/package_management.md`
- `kb/loongson-2k1000-board-kb-preview/raw/stage3/raw_stage3_evidence_combined.txt`
