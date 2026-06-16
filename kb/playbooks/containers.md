# Docker / Podman 不可用

## 结论

Docker / Podman 不可作为当前板端默认开发或部署路径。

## 当前状态

- `docker` command missing。
- `podman` command missing。
- 当前证据不支持把容器运行时写成可用。

## 历史证据

- `software_stack.md` 与 `compatibility_matrix.md` 标记 Docker / Podman not usable。
- `package_management.md` 记录 Docker / Podman 的 installed、runtime、apt candidate 边界。

## 风险

- 容器运行涉及内核能力、存储、权限和服务配置。
- 当前板端内存和根分区空间有限。

## 禁止操作

- 不默认安装 Docker / Podman。
- 不启动、修改或新增容器服务配置。
- 不把容器作为 P6 验收路径。

## 允许的只读排查

- `which docker`
- `docker --version`
- `which podman`
- `podman --version`
- `apt-cache policy docker.io podman`

## 待确认

- 当前源是否提供可用包。
- 内核、cgroup、存储驱动、权限和服务管理是否满足容器运行。

## 证据路径

- `kb/software_stack.md`
- `kb/compatibility_matrix.md`
- `kb/loongson-2k1000-board-kb-preview/package_management.md`
- `kb/loongson-2k1000-board-kb-preview/raw/stage3/raw_stage3_evidence_combined.txt`
