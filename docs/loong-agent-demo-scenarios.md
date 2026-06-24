# Loong Agent Demo Scenarios

last_updated: 2026-06-24
audience: competition technical judges
status: draft

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

Measured board snapshot on 2026-06-24:

```text
Architecture: loongarch64
System: Loongnix-Embedded GNU/Linux 20 (DaoXiangHu)
Kernel: 4.19.0-18-loongson-2k
Node.js: v14.16.1
npm: missing
git: 2.20.1
gcc: 8.3.0 (Loongnix 8.3.0-6.lne.vec.35)
g++: missing
Python: 3.7.3
pip: available through python3 -m pip / pip3
Docker/Podman: missing
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

- Playwright currently documents supported Linux platforms as Debian/Ubuntu on x86-64 or arm64 and requires recent Node.js versions.
- Docker multi-platform workflows rely on image/platform variants and build strategies such as QEMU, native nodes, or cross-compilation; those assumptions do not automatically make a LoongArch board ready to run arbitrary container workflows.
- Node.js official download pages list current/EOL release lines and direct users to archive/unofficial builds for other platforms; board-side runtime availability must be measured, not assumed.

## Candidate Cases

### Case 1: npm/native dependency workflow blocks on board

Traditional workflow:

```bash
npm install
npm run build
```

Why it works on x86/Raspberry Pi:

- Node.js and npm are usually installed together.
- C++ build tools are commonly available or easy to install.
- Many native packages provide prebuilt binaries for x64/arm64, reducing local compilation.

Why it fails or becomes unsafe on the Loongson board:

- `npm` and `g++` are missing.
- `apt-cache policy` shows candidates, but candidates are not installed capability.
- The current board has mixed `lne` installed packages and `lnd` candidates in key dependency chains.
- Broad package repair or `full-upgrade` is high risk on a small board with limited storage and no confirmed recovery path.

What `loong-agent` demonstrates:

- Runs in the existing Node 14 board environment without requiring `npm install`.
- Uses `compat` and knowledge playbooks to identify the failure as package/toolchain readiness, not application code failure.
- Avoids dangerous package upgrades.
- Recommends the minimal viable path: keep the agent lightweight, avoid new npm runtime dependencies, use direct source sync and board-side verification.

Demo evidence:

```bash
node -v
which npm || true
which g++ || true
apt-cache policy npm g++ g++-8 node-gyp libnode-dev libssl-dev libssl1.1
node src/index.js compat
node scripts/test-knowledge-layer.js
node scripts/test-runtime.js
```

Judging value:

- Best first demo. It is already real, reproducible, low risk, and directly tied to `loong-agent` design choices.

### Case 2: Playwright/Chromium browser automation workflow is not board-ready

Traditional workflow:

```bash
npm init playwright@latest
npx playwright install --with-deps
npx playwright test
```

Why it works on x86/Raspberry Pi:

- On supported Linux environments, Playwright downloads browser binaries and runs headless tests.
- x86-64 and arm64 receive much stronger upstream support.

Why it fails or becomes unsafe on the Loongson board:

- Board Node.js is `v14.16.1`; modern Playwright requires newer Node versions.
- `npm`/`npx` are missing.
- Chromium/Chrome are missing.
- LoongArch browser binaries and dependencies cannot be assumed.

What `loong-agent` should demonstrate:

- Detects that the browser automation workflow is not currently board-ready.
- Separates "frontend validation intent" from "Playwright on board" implementation.
- Routes the demo to a safe alternative: TUI smoke tests, static HTML session export, or remote browser validation while keeping board-side runtime proof.

Demo evidence:

```bash
node -v
which npm npx chromium chromium-browser google-chrome || true
node src/index.js compat
node scripts/board-smoke.js --full
```

Judging value:

- Good second demo if framed as intelligent rerouting, not as a failed browser demo.

### Case 3: Dockerized deployment cannot be assumed on LoongArch board

Traditional workflow:

```bash
docker compose up
docker pull <image>
```

Why it works on x86/Raspberry Pi:

- Docker or compatible container runtimes are often preinstalled or easy to install.
- Common images usually provide `linux/amd64` and often `linux/arm64` variants.

Why it fails or becomes unsafe on the Loongson board:

- Docker and Podman commands are missing.
- Kernel, cgroup, storage driver, package source, service, permission, and image architecture readiness are all unconfirmed.
- Installing or enabling a container runtime is not a safe default board-side action.

What `loong-agent` demonstrates:

- Detects the missing container runtime.
- Uses the containers playbook to avoid default installation.
- Chooses direct source sync to `/home/loongson/loong-pi-agent` plus Node-based verification, matching the current project deployment rule.

Demo evidence:

```bash
which docker podman || true
docker --version || true
podman --version || true
apt-cache policy docker.io podman
node src/index.js compat
```

Judging value:

- Useful as a deployment contrast case, but less strong than Case 1 because the failure can look like "Docker not installed" unless we connect it to image/platform and runtime assumptions.

### Case 4: Python package workflow needs precise environment diagnosis

Traditional workflow:

```bash
pip install <package>
python app.py
```

Why it works on x86/Raspberry Pi:

- Many packages publish wheels for common architectures and modern Python versions.
- `pip` command availability usually maps closely to Python package management availability.

Why it can fail or mislead on the Loongson board:

- Python is `3.7.3`, which is old for many current packages.
- `pip` command availability differs from `python3 -m pip` / `pip3` availability.
- LoongArch wheels cannot be assumed, so installs may fall back to source builds and require missing toolchains.

What `loong-agent` demonstrates:

- Does not incorrectly say "pip is missing" when `python3 -m pip` works.
- Flags package install and wheel availability as pending confirmation.
- Keeps package operations read-only until dependency size, Python version, and build requirements are known.

Demo evidence:

```bash
python3 --version
which pip pip3 || true
python3 -m pip --version
python3 -c "import sys; print(sys.version)"
```

Judging value:

- Good supporting case for environment precision, but weaker as a main live demo unless we choose a concrete package with a safe offline reproduction.

## Recommended First Demo Set

Use three cases:

1. Main live demo: npm/native dependency and `g++`/`node-gyp` readiness.
2. Short live contrast: Docker/Podman deployment assumption rejected and replaced by direct source sync.
3. Recorded/supporting demo: Playwright/Chromium workflow rerouted to board-safe validation.

Keep the Python case in reserve for Q&A or report appendix.

## Demo Flow

### Part A: Baseline contrast

On x86 Linux or Raspberry Pi:

```bash
node -v
npm -v
g++ --version
docker --version
```

Expected: common workflow tools are available, or at least installation is a normal low-risk action.

On Loongson board:

```bash
uname -m
node -v
which npm g++ docker podman chromium chromium-browser google-chrome || true
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
- The report distinguishes confirmed measurements from pending assumptions.

## Do Not Do

- Do not run `apt upgrade`, `apt full-upgrade`, or broad package repair.
- Do not install `npm`, `g++`, Docker, Podman, Chromium, or Playwright during the live demo unless a recovery plan and dependency review are confirmed.
- Do not use `dist/` packaging or deployment.
- Do not present package candidates as installed capability.
- Do not describe Windows x64 local output as the x86 Linux/Raspberry Pi comparison.
- Do not claim LoongArch-specific package availability without current source or measured evidence.

## Pending Confirmation

- A real x86 Linux or Raspberry Pi comparison machine and its command output.
- Whether the competition judges prefer a live board-only demo or a side-by-side split-screen demo.
- Whether we should create a small artificial npm/native dependency project for a controlled failure reproduction.
- Whether browser validation should be remote-browser-based or replaced entirely with TUI/static export validation.
- Official scoring rubric and report format.

## Next Steps

1. Capture real x86 Linux or Raspberry Pi baseline output for `node`, `npm`, `g++`, Docker, and optionally Playwright.
2. Re-sync current source to `/home/loongson/loong-pi-agent` without `dist`, `.git`, `node_modules`, `.env`, or `runs`.
3. Run board verification:

```bash
node src/index.js compat
node scripts/test-knowledge-layer.js
node scripts/test-runtime.js
```

4. Decide whether Case 1 alone is enough for the live demo or whether Case 2/3 should be shown as a compact matrix.
5. Turn the chosen cases into a 3-part deliverable: live command script,录屏 script, and written report section.
