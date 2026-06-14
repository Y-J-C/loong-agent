# Software Stack

status: measured
last_updated: 2026-06-14
sources: kb/loongson-2k1000-board-kb-preview/software_stack.md; kb/loongson-2k1000-board-kb-preview/package_management.md; kb/loongson-2k1000-board-kb-preview/development_environment.md
confidence: high

## Content

The board has a minimal but useful local software stack. It is suitable for small C programs, shell diagnostics, Python scripts, and Node.js runtime scripts without npm dependencies.

Available core tools:

- C toolchain: `gcc`, `cc`, binutils, `make`, and `cmake` are available.
- CMake version is 3.13.4, so modern CMake projects may need compatibility adjustment.
- Python: `python3` 3.7.3 is available; `python` 2.7.16 also exists and should be treated as legacy.
- Python packaging: `pip3` and `python3 -m pip` work, but the active pip module is user-local. Prefer `python3 -m pip`.
- Node.js: `node` v14.16.1 is available.
- Shell and transfer tools: `bash`, `sh`, `git`, `ssh`, `scp`, `curl`, `wget`, archive tools, and basic binary inspection tools are available.

Missing or incomplete tools:

- `g++` and `c++` are missing, so C++ builds are not ready by default.
- `clang` is missing.
- `npm` and `npx` are missing, so npm workflows cannot run directly on the board.
- `rsync` is missing.
- `sqlite3` CLI, Redis, PostgreSQL CLI, Docker, Podman, Rust, Go, Java, OpenCV development packages, and complete Qt/GTK development paths are not available as ready defaults.
- Qt wrapper traces exist in evidence but must not be treated as a complete Qt development environment.

Recommended development path:

- Keep `loong-agent` runtime compatible with Node 14, CommonJS, and no npm runtime dependencies.
- Use local C and Python only for small, low-risk tasks.
- Prefer host-side development or cross-compilation for larger builds.
- Use `scp` for transfer unless `rsync` is explicitly installed and validated.
- Avoid container-first designs on the board because Docker / Podman are not usable in the snapshot.

## Unknowns

- Whether `g++`, `npm`, `rsync`, or other candidates can be installed safely is pending disk, dependency, and source validation.
- Exact package install cost for development headers is pending confirmation.
- Long-term stability of user-local pip 24.0 on Python 3.7.3 is pending confirmation.
- Whether GUI, multimedia, and hardware acceleration development stacks can be made usable is not confirmed.
