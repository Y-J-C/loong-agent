# Cross Compile

status: sourced
last_updated: 2026-07-06
sources: kb/book_dev_workflows_reference.md; kb/build_guide.md; kb/loongarch_isa.md; kb/software_stack.md; kb/compatibility_matrix.md
confidence: medium

## Content

Cross compilation knowledge in this KB is a boundary guide, not a verified toolchain recipe. The current board target is `loongarch64`; `mips64el` material from the book or older Loongson systems must not be reused without explicit conversion and board verification.

Phase D entries are `book_reference + needs_board_check`. They can help the Agent ask the right questions about target triple, ABI, compiler prefix, sysroot, headers, and runtime libraries. They must not recommend downloading or installing a cross toolchain as a default action.

Current verified constraints:

- Native `gcc` is known in the existing software stack, but C++ build capability is incomplete because `g++` is missing.
- `build_guide.md` remains the preferred summary for current board build boundaries.
- `loongarch_isa.md` remains the preferred boundary for `loongarch64` versus `mips64el`.

Read-only checks that may be useful before any build plan:

```bash
gcc -dumpmachine
gcc --version
file ./binary
readelf -h ./binary
ldd ./binary
```

## Unknowns

- Verified cross compiler prefix.
- Verified sysroot path and library layout.
- Whether project build scripts already encode `mips64el`, x86_64, ARM, or stale Loongnix assumptions.
- Whether generated binaries match the board ABI and runtime libraries.
