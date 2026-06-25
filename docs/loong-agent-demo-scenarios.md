# Loong Agent Demo Scenarios

last_updated: 2026-06-25
audience: competition technical judges
status: refined draft

## Goal

Show that `loong-agent` solves a real LoongArch development problem:

1. A normal workflow works on common platforms such as x86 Linux or Raspberry Pi.
2. The same workflow fails or becomes unsafe on the Loongson board because of architecture, runtime, package, or board constraints.
3. `loong-agent` reads the board state, narrows the failure type, avoids risky fixes, chooses a minimal viable path, verifies the result on the board, and records reusable knowledge.

The demo should not argue that Loongson is "worse". It should argue that LoongArch board development invalidates assumptions that are usually hidden in x86/Raspberry Pi workflows, and that `loong-agent` makes those assumptions visible and actionable.

## Current Evidence

Notion positioning:

- `loong-agent` is an edge development agent running in the Loongson board development site.
- Its value is the loop: understand target, sense project and system state, execute tools, collect logs, verify results, and preserve reusable knowledge.
- The judging story should focus on board-side proof, not general chat or code generation.

Measured board snapshot on 2026-06-25:

```text
Architecture: loongarch64
System: Loongnix-Embedded GNU/Linux 20 (DaoXiangHu)
Kernel: 4.19.0-18-loongson-2k
glibc: 2.28
CPU features: cpucfg, lam, fpu, lsx, crc32, lbt_mips; no lasx observed
Node.js: v14.16.1
npm: missing
git: 2.20.1
gcc: 8.3.0 (Loongnix 8.3.0-6.lne.vec.35)
g++: missing
CMake: 3.13.4
Make: 4.2.1
rustc/cargo: missing; apt candidates exist but are old
Python: 3.7.3
pip: available through python3 -m pip / pip3
Docker/Podman: missing; docker.io has no apt candidate in current source
Chromium/Chrome: missing
Root filesystem free: about 1.6G
/data free: about 4.8G
Memory: 1.4GiB total
```

`node src/index.js compat` on the board reports:

- `loong-agent` can run on the current Node 14 runtime.
- Original npm-based workflows are not ready because `npm` and `g++` are missing.
- `g++-8` and `node-gyp/libnode-dev/libssl-dev` dependency paths mix `lne` installed packages with `lnd` candidates.
- Simulated installs fail, so the agent should not force `g++`, `npm`, or broad upgrades.

External reference points to mention in the report:

- Rust platform support lists `loongarch64-unknown-linux-gnu` as Tier 2 with host tools, but with kernel 5.19+, glibc 2.36, and LSX required. The current board is kernel 4.19 and glibc 2.28, so Rust support cannot be assumed from the target name alone. Source: https://doc.rust-lang.org/nightly/rustc/platform-support.html
- Docker multi-platform builds depend on target platform variants and explicit strategies such as QEMU, multiple native nodes, or cross-compilation. Source: https://docs.docker.com/build/building/multi-platform/
- Docker official `node` images list architectures such as `amd64`, `arm64v8`, `ppc64le`, and `s390x`, but no `loong64` in the checked manifest file. Source: https://raw.githubusercontent.com/docker-library/official-images/master/library/node
- OpenSSL has LoongArch runtime capability detection using `AT_HWCAP`, and defines separate LSX and LASX capability bits. Source: https://raw.githubusercontent.com/openssl/openssl/master/crypto/loongarch_arch.h and https://raw.githubusercontent.com/openssl/openssl/master/crypto/loongarchcap.c

## Refined Scenario Selection

The image reference proposes five possible additions:

| Candidate | Fit | Decision | Reason |
|---|---:|---|---|
| OpenSSL / LSX / LASX leads to SIGILL | High | Advanced case / Q&A | Strong LoongArch specificity. Current board has LSX but no observed LASX, so it can show CPU-feature diagnosis. It needs a safe controlled repro before becoming the main live demo. |
| glibc / libutil.so / dynamic library compatibility | Medium-high | Report appendix | Good ABI story, but current board is glibc 2.28 while the common `libutil` merge issue is glibc 2.34+. It is better as background unless we have a real failing binary. |
| Rust / Cargo / LoongArch target constraints | High | Main case 2 | Official Rust target requirements conflict with current board kernel/glibc baseline. This is precise, source-backed, and different from the C++/npm case. |
| CMake / C++ project missing g++ | High | Main case 1 | Already measured on board. It directly shows toolchain detection, package-risk reasoning, and safe fallback. |
| Image platform `linux/loong64` / official image missing | High | Main case 3 | Official Node image architecture list lacks loong64, and Docker is not board-ready. This shows deployment-path adaptation. |

Recommended final demo set:

1. CMake/C++ native build fails because `g++`/`c++` is missing, while `gcc`, `make`, and `cmake` exist.
2. Rust/Cargo LoongArch target is not automatically usable because the current board misses Rust tools and does not meet official kernel/glibc requirements.
3. Docker/official image deployment fails as a platform assumption: the board has no Docker/Podman path, and official Node image manifests checked do not include `loong64`.
4. OpenSSL LSX/LASX SIGILL remains the advanced answer-defense case after a safe reproduction is created.

## Candidate Cases

### Case 1: CMake/C++ or npm-native build blocks on missing C++ toolchain

Traditional workflow:

```bash
cmake -S . -B build
cmake --build build
```

Why it works on x86/Raspberry Pi:

- CMake, Make, GCC, and G++ are usually installed together through `build-essential` or equivalent developer packages.
- Native npm packages, CMake addons, and many CLI tools assume a working C++ compiler.

Why it fails or becomes unsafe on the Loongson board:

- `cmake`, `make`, and `gcc` are available, but `g++` and `c++` are missing.
- `npm` is also missing, so Node native dependency workflows are blocked before application logic is reached.
- `apt-cache policy` shows candidates, but candidates are not installed capability.
- The current board has mixed `lne` installed packages and `lnd` candidates in key dependency chains.
- Broad package repair or `full-upgrade` is high risk on a small board with limited storage and no confirmed recovery path.

What `loong-agent` demonstrates:

- Runs in the existing Node 14 board environment without requiring `npm install`.
- Uses `compat` and knowledge playbooks to identify the failure as C++ toolchain/package readiness, not application code failure.
- Avoids dangerous package upgrades.
- Recommends the minimal viable path: use C/Node-only board-side validation now, keep the agent lightweight, avoid new npm runtime dependencies, and use direct source sync plus board-side verification.

Demo evidence:

```bash
uname -m
cmake --version
make --version
gcc --version
which g++ c++ || true
node -v
which npm || true
apt-cache policy npm g++ g++-8 node-gyp libnode-dev libssl-dev libssl1.1
node src/index.js compat
node scripts/test-knowledge-layer.js
node scripts/test-runtime.js
```

Judging value:

- Best first live demo. It is already real, reproducible, low risk, and directly tied to `loong-agent` design choices.

### Case 2: Rust/Cargo target support is not equal to board readiness

Traditional workflow:

```bash
cargo build --target loongarch64-unknown-linux-gnu
```

Why it works on x86/Raspberry Pi:

- Rustup, rustc, cargo, and standard-library targets are commonly available for mainstream development hosts.
- Developers often treat a listed target triple as "the board can build or run it".

Why it fails or becomes unsafe on the Loongson board:

- `rustc` and `cargo` are missing.
- The current apt candidates are old: `rustc 1.41.1` and `cargo 0.43.1`.
- Official Rust target documentation lists `loongarch64-unknown-linux-gnu` with kernel 5.19+, glibc 2.36, and LSX required; the current board is kernel 4.19 and glibc 2.28.
- The board has LSX, but the kernel/glibc baseline still fails the official target conditions.

What `loong-agent` should demonstrate:

- Reads board facts: kernel, glibc, CPU feature flags, installed commands, and package candidates.
- Separates target-triple existence from actual board readiness.
- Marks Rust-native build as `待确认` or blocked, then recommends host-side/cross-build or a board-compatible lightweight path.

Demo evidence:

```bash
uname -m
uname -r
getconf GNU_LIBC_VERSION
grep -m1 -E 'lsx|lasx' /proc/cpuinfo || true
which rustc cargo || true
apt-cache policy rustc cargo
```

Judging value:

- Strong second demo. It proves `loong-agent` is not only checking missing commands; it is reasoning over official target constraints and measured board facts.

### Case 3: Dockerized deployment and official image platform assumptions fail

Traditional workflow:

```bash
docker compose up
docker pull node:22
```

Why it works on x86/Raspberry Pi:

- Docker or compatible container runtimes are often preinstalled or easy to install.
- Common images usually provide `linux/amd64` and often `linux/arm64` variants.

Why it fails or becomes unsafe on the Loongson board:

- Docker and Podman commands are missing.
- `docker.io` currently has no apt candidate in the board source.
- The checked Docker official Node image metadata lists mainstream architectures such as `amd64` and `arm64v8`, but not `loong64`.
- Kernel, cgroup, storage driver, package source, service, permission, and image architecture readiness are all unconfirmed.
- Installing or enabling a container runtime is not a safe default board-side action.

What `loong-agent` demonstrates:

- Detects the missing container runtime.
- Checks image-platform assumptions separately from local Docker availability.
- Uses the containers playbook to avoid default installation or service changes.
- Chooses direct source sync to `/home/loongson/loong-pi-agent` plus Node-based verification, matching the current project deployment rule.

Demo evidence:

```bash
uname -m
which docker podman || true
docker --version || true
podman --version || true
apt-cache policy docker.io podman
node src/index.js compat
```

Judging value:

- Strong third demo if shown with the official image architecture evidence. It makes the deployment story concrete: `loong-agent` chooses source sync because container deployment is not a verified path.

### Case 4: OpenSSL LSX/LASX CPU-feature mismatch can become SIGILL

Traditional workflow:

```bash
use a prebuilt crypto/native binary optimized for LoongArch vector extensions
```

Why it works on x86/Raspberry Pi:

- CPU feature dispatch is mature and common binaries usually match broadly available x86-64 or ARM64 feature baselines.
- Developers often assume "LoongArch64 binary" means "runs on every LoongArch64 board".

Why it can fail or mislead on the Loongson board:

- The current board reports `lsx` but no observed `lasx`.
- OpenSSL has separate LSX and LASX runtime capability bits, so a binary path must match actual hardware capability.
- A binary built or dispatched incorrectly for LASX on an LSX-only board can fail as illegal instruction (`SIGILL`).

What `loong-agent` demonstrates:

- Reads `/proc/cpuinfo` feature flags before recommending vector-optimized binaries.
- Distinguishes architecture (`loongarch64`) from CPU extension (`lsx` vs `lasx`).
- Recommends safe reproduction and feature-gated builds instead of blindly running unknown binaries.

Demo evidence:

```bash
uname -m
grep -m1 '^features' /proc/cpuinfo
openssl version -a 2>/dev/null || true
```

Judging value:

- Best as a high-level defense/Q&A case until a safe mini repro is prepared. It shows deep LoongArch-specific insight but should not be the first live demo.

### Reserve Case: Python package workflow needs precise environment diagnosis

This remains useful as an appendix. The current board has Python 3.7.3 and `python3 -m pip`, but generic `pip` assumptions and wheel availability remain unsafe to assume. It demonstrates precision, but is weaker than the selected three cases unless a concrete package failure is reproduced safely.

## Recommended First Demo Set

Use three cases:

1. Main live demo: CMake/C++ or npm-native workflow blocked by missing `g++`/`c++`, with package-risk diagnosis.
2. Main live or recorded demo: Rust/Cargo target constraints, using official Rust requirements versus measured board kernel/glibc/LSX facts.
3. Main live or report demo: Docker official image/platform assumption rejected, replaced by direct source sync and board-side verification.
4. Advanced Q&A: OpenSSL LSX/LASX SIGILL risk and CPU-extension diagnosis.

Keep the Python case in reserve for appendix only.

## Demo Flow

### Part A: Baseline contrast

On x86 Linux or Raspberry Pi:

```bash
uname -m
node -v
npm -v
g++ --version
rustc --version
cargo --version
docker --version
```

Expected: common workflow tools are available, or at least installation is a normal low-risk action.

On Loongson board:

```bash
uname -m
uname -r
getconf GNU_LIBC_VERSION
grep -m1 '^features' /proc/cpuinfo
node -v
which npm g++ c++ rustc cargo docker podman || true
cmake --version
make --version
```

Expected: LoongArch board reality differs from the common assumptions.

### Part B: Agent diagnosis

On Loongson board:

```bash
cd /home/loongson/loong-pi-agent
node src/index.js compat
```

Expected:

- Agent reports that `loong-agent` itself can run.
- Agent rejects unsafe npm/g++ install assumptions.
- Agent explains the version-line and package-risk evidence.
- Agent keeps package candidates, installed capability, and external target requirements separate.

### Part C: Board-safe execution path

On Loongson board:

```bash
node scripts/test-knowledge-layer.js
node scripts/test-runtime.js
node scripts/board-smoke.js --full
```

Expected:

- Board-side verification passes.
- The project proves a lightweight Node 14-compatible path instead of relying on unavailable npm workflows.

### Part D: Evidence handoff

Collect:

- terminal recording for baseline and agent diagnosis
- `compat` output
- test command output
- session export / board smoke report if generated
- this scenario matrix in the written report

## Acceptance Criteria

- The demo clearly shows at least one workflow that works on common platforms but fails or is unsafe on LoongArch board.
- The failure is backed by command output, not a claim.
- `loong-agent` identifies the failure category and explains why naive fixes are risky.
- A board-safe alternative path is verified on the actual Loongson board.
- The final selected scenarios each demonstrate a different capability: environment/toolchain diagnosis, target-constraint reasoning, deployment-platform adaptation, and CPU-feature awareness.
- The report distinguishes confirmed measurements from pending assumptions.

## Do Not Do

- Do not run `apt upgrade`, `apt full-upgrade`, or broad package repair.
- Do not install `npm`, `g++`, Rust/Cargo, Docker, Podman, Chromium, or Playwright during the live demo unless a recovery plan and dependency review are confirmed.
- Do not intentionally run unknown LASX binaries or illegal-instruction repros on the live board until the repro is isolated and recoverable.
- Do not use `dist/` packaging or deployment.
- Do not present package candidates as installed capability.
- Do not describe Windows x64 local output as the x86 Linux/Raspberry Pi comparison.
- Do not claim LoongArch-specific package availability without current source or measured evidence.

## Pending Confirmation

- A real x86 Linux or Raspberry Pi comparison machine and its command output.
- Whether the competition judges prefer a live board-only demo or a side-by-side split-screen demo.
- Whether to create a tiny CMake C++ project as a controlled `g++` failure fixture.
- Whether to create a safe OpenSSL/CPU-feature diagnosis fixture without executing unsafe LASX code.
- Whether Docker image-platform evidence should be shown as a registry/manifest screenshot or as a report table.
- Official scoring rubric and report format.

## Next Steps

1. Capture real x86 Linux or Raspberry Pi baseline output for `node`, `npm`, `g++`, `rustc`, `cargo`, and Docker.
2. Re-sync current source to `/home/loongson/loong-pi-agent` without `dist`, `.git`, `node_modules`, `.env`, or `runs`.
3. Run board verification:

```bash
node src/index.js compat
node scripts/test-knowledge-layer.js
node scripts/test-runtime.js
```

4. Add a tiny CMake C++ fixture or scripted command sequence only if it can be kept non-destructive.
5. Turn the chosen cases into a 3-part deliverable: live command script, recording script, and written report section.
