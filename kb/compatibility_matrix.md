# Compatibility Matrix

status: measured
last_updated: 2026-06-14
sources: kb/loongson-2k1000-board-kb-preview/compatibility_matrix.md; kb/loongson-2k1000-board-kb-preview/software_stack.md
confidence: high

## Content

This matrix is for engineering choices on the current Loongson 2K1000 board snapshot. It separates installed runtime, package candidate, missing command, and incomplete wrapper states.

Usable now:

| Capability | Status | Practical judgment |
|---|---|---|
| C runtime/build | usable | `gcc`, `cc`, `make`, binutils available |
| CMake | usable with constraints | CMake 3.13.4 is old |
| Python scripts | usable with constraints | Python 3.7.3; prefer `python3 -m pip` |
| Node.js scripts | usable with constraints | Node v14.16.1; no npm |
| Shell diagnostics | usable | `bash`, `sh`, core tools available |
| SSH / SCP | usable | good fit for remote maintenance and file transfer |

Not ready by default:

| Capability | Status | Practical judgment |
|---|---|---|
| C++ local builds | incomplete | `g++` / `c++` missing |
| npm workflows | incomplete | `npm` / `npx` missing |
| Docker / Podman | not usable | command and package path not ready |
| Rust / Go / Java | not usable | command missing; package candidates do not equal installed tools |
| SQLite CLI / DB services | not ready | Python sqlite module exists, CLI/service tools missing |
| Qt / GTK / OpenCV development | not ready | wrappers or runtime traces do not prove dev environment |
| Full web service deployment | constrained | possible only for tiny scripts; dependency installation risk remains |

Compatibility rules for agent work:

- Do not add npm runtime dependencies to `loong-agent`.
- Keep runtime code CommonJS and Node 14 compatible.
- Avoid build flows that require native npm install on the board.
- Treat package candidates as options requiring review, not as available capabilities.
- Treat runtime libraries and wrapper files as insufficient proof of development package availability.

## Unknowns

- Safe install path for `npm`, `g++`, `rsync`, and dev packages remains pending.
- Actual free disk and dependency expansion must be checked before any package install.
- Docker / Podman availability through alternate repositories is not confirmed.
- Qt, GTK, OpenCV, GUI display, audio, and hardware acceleration paths need separate validation.
