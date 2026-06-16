# g++ / c++ 缺失

## 结论

C 工具链基本可用，但 C++ 本地构建入口不完整，因为 `g++` / `c++` 缺失。

## 当前状态

- `gcc`、`cc`、`make`、`cmake` 可用。
- `g++`、`c++`、`clang` 不可用。
- `g++`、`build-essential` 有 apt candidate，但不是已安装能力。

## 历史证据

- `software_stack.md` 记录 C 可用、C++ 缺失。
- `compatibility_matrix.md` 将 C++ local builds 标为 incomplete。
- `package_management.md` 区分 installed、runtime available、apt candidate exists、missing。

## 风险

- 本地编译大型 C++ 项目会受内存、磁盘和依赖规模限制。
- 安装 `build-essential` 会引入开发依赖，需单独评估。

## 禁止操作

- 不默认安装 `g++`、`clang` 或 `build-essential`。
- 不把 apt candidate 写成 installed。

## 允许的只读排查

- `gcc --version`
- `make --version`
- `cmake --version`
- `which g++`
- `g++ --version`
- `apt-cache policy g++ build-essential clang`

## 待确认

- C++ 工具链安装依赖规模和剩余空间。
- 是否采用 host-side/cross build 更合适。

## 证据路径

- `kb/software_stack.md`
- `kb/compatibility_matrix.md`
- `kb/loongson-2k1000-board-kb-preview/package_management.md`
- `kb/loongson-2k1000-board-kb-preview/raw/stage3/raw_stage3_evidence_combined.txt`
