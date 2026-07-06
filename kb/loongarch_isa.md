status: sourced
last_updated: 2026-07-06
sources: kb/board_profile.md; kb/environment_report.md; kb/software_stack.md; kb/compatibility_matrix.md; kb/build_guide.md
confidence: medium

# LoongArch ISA 与架构边界

当前知识库面向的板端运行环境是 loongarch64。任何来自 mips64el、LoongISA、x86、ARM 或书稿旧环境的命令和工具链，都必须先经过架构边界检查。

## Content

- 当前板端架构按 loongarch64 处理。
- loongarch64 与 mips64el 不能混用：工具链前缀、二进制包、ABI、源码条件编译和第三方预编译产物都需要分别确认。
- 不把“龙芯”泛称等同于同一 ABI 或同一工具链。
- 编译参数应以当前工具链实际输出为准，优先用只读命令确认目标三元组和编译器能力，再决定是否使用架构相关参数。
- 书稿或外部资料中出现的 MIPS、mips64el、LoongISA 或旧 Loongnix 流程，只能作为参考来源，不能直接作为当前板端事实。

判断边界：

- 如果问题涉及二进制包、预编译库、汇编优化、SIMD、JIT、容器镜像或语言运行时原生模块，必须显式检查 loongarch64 支持。
- 如果问题只涉及通用 POSIX/Linux 命令，仍需要结合当前系统工具是否存在、版本是否满足和是否有板端风险。
- 如果资料来自书稿或外部社区，入库前需要标记来源和验证状态。

## Unknowns

- 当前工具链的精确 target triple、默认 ABI 和推荐 flags 待由板端只读命令确认。
- LSX/LASX、LBT、性能计数器和平台优化能力未纳入当前已验证事实。
- 官方 LoongArch 手册版本、与当前内核/发行版的对应关系待补。
- 第三方生态对 loongarch64 的支持状态需要进入后续 ecosystem 审核流程。
