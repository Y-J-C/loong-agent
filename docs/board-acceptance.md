# Board Acceptance

This document defines the board-side release acceptance flow for `loong-agent`.

## Target Board

- Board: Loongson LS2K1000 PAI UDB v1.5
- Runtime: Node.js `v14.16.1`
- Deployment path for acceptance: user-writable directory, for example `/home/loongson/loong-pi-agent-release-test`

Acceptance must not modify system packages.

## Release Package

Build on the development machine:

```bash
node scripts/create-offline-demo.js
node scripts/pack-release.js --out dist/loong-agent
```

Expected artifacts:

```text
dist/loong-agent/
dist/loong-agent.tar.gz
```

The package contains:

- `src/`
- `boards/`
- `kb/`
- `scripts/`
- `docs/`
- `runs/sample-offline-demo.jsonl`
- `runs/sample-offline-demo.html`
- `runs/sample-offline-demo.md`
- `README.md`
- `package.json`
- `.env.example`
- `RELEASE_MANIFEST.json`

The package must not contain `.env`, `.git`, API keys, tokens, authorization headers, secrets, credentials, or passwords.

## Board Installation

Copy `dist/loong-agent.tar.gz` to the board, then run only inside a user-writable directory:

```bash
mkdir -p /home/loongson/loong-pi-agent-release-test
cd /home/loongson/loong-pi-agent-release-test
tar -xzf loong-agent.tar.gz
cd loong-agent
```

Do not run `npm install`.

## Required Smoke

```bash
node -v
node src/index.js compat
node src/index.js diagnose
node scripts/board-smoke.js --full
node src/index.js session latest --html --out runs/board-release-latest.html
```

Expected output files:

- `runs/board-smoke-report.json`
- `runs/board-smoke-report.md`
- `runs/board-smoke-latest.html`
- `runs/board-release-latest.html`
- `runs/sample-offline-demo.html`

## Optional Model Check

If an OpenAI-compatible API key is available:

```bash
cp .env.example .env
# edit .env in a safe terminal, never paste it into logs
node scripts/board-smoke.js --with-model
```

If no API key is available, the model check is skipped and does not fail acceptance.

## Offline Demo

Open this static file for a no-network replay:

```text
runs/sample-offline-demo.html
```

It is generated from a local sample session and does not prove live API/network availability.

## Prohibited Actions

Do not run:

```bash
npm install
sudo apt install npm g++
sudo apt full-upgrade
```

Do not modify system packages, service state, ownership, or board system files during acceptance.
