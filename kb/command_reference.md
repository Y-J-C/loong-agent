# Command Reference

status: sourced
last_updated: 2026-06-14
sources: src/tools.js READONLY_COMMAND_METADATA; kb/loongson-2k1000-board-kb-preview/README.md; kb/loongson-2k1000-board-kb-preview/scripts/README.md
confidence: high

## Content

The authoritative command allowlist for the agent is `READONLY_COMMAND_METADATA` in `src/tools.js`. This Markdown file is supporting documentation only; if it disagrees with structured metadata, the structured metadata wins.

Risk levels:

- L0: local read-only state query. It must not modify files, packages, services, network, boot configuration, partition tables, or peripheral state.
- L1: read-only but potentially heavier, log-reading, device-state-dependent, or requiring extra caution in interpretation.
- Forbidden: install, upgrade, write, repair, reconfigure, modify boot/network/device-tree/kernel state, or probe peripherals in a way that can affect hardware.

L0 commands currently represented in `READONLY_COMMAND_METADATA`:

```text
uname -a
uname -m
cat /etc/os-release
lscpu
free -h
df -h
node -v
npm -v
git --version
gcc -v
clang -v
python3 --version
which node
which npm
which git
which curl
which wget
node src/index.js diagnose
node src/index.js compat
node src/index.js --help
node src/index.js tui --help
node src/index.js sessions
node src/index.js sessions --tree
node src/index.js session latest
node src/index.js session lineage latest
node scripts/test-runtime.js
node scripts/test-session-tree.js
node scripts/test-cli-smoke.js
node scripts/test-tui-renderer.js
node scripts/test-tui-commands.js
node scripts/test-tui-input.js
node scripts/test-tui-theme.js
node scripts/test-tui-stats.js
node scripts/test-tui-export-demo.js
ls /dev/i2c*
i2cdetect -l
```

L1 commands currently represented in `READONLY_COMMAND_METADATA`:

```text
dmesg | tail -n 80
```

Forbidden command families and operations:

```text
apt install
apt upgrade
apt full-upgrade
fsck
fdisk
parted
mkfs
dd
system package modification
/boot or EFI modification
device tree or kernel parameter modification
eth0/eth1 network reconfiguration
GPIO write/export operations
I2C/SPI blind scans or wiring tests
service state modification
```

Preview package command boundary:

- Allowed for document package testing: `less`, `grep`, `find`, and reading raw evidence files.
- Allowed for local knowledge verification: checksum checks, path existence checks, file listing, and read-only keyword search.
- The preview package does not include formal executable scripts.
- `scripts/README.md` explicitly says `collect_env.sh`, `check_software_stack.sh`, and `check_peripherals_readonly.sh` are not formally included yet.

Commands and operations that must not be suggested from the preview package alone:

- Software install or upgrade commands.
- `apt upgrade` or broad package modification.
- `fsck`, `fdisk`, `parted`, `mkfs`, `dd`, partition rewriting, or filesystem repair.
- Modifying `/boot`, EFI files, device tree, kernel parameters, or network configuration.
- Peripheral bus scanning or wiring tests before hardware details are confirmed.
- Deploying services or agent runtime as part of knowledge package validation.

Recommended diagnostic posture:

- Use `command_reference` before suggesting board diagnostic shell commands.
- Prefer one small read-only command at a time.
- Report command purpose, expected evidence, and risk boundary.
- If a command is not listed in `READONLY_COMMAND_METADATA`, do not present it as executable by the agent.

## Unknowns

- Formal read-only collection scripts are not yet validated.
- Final executable collection scripts are not yet complete.
- Any command outside `READONLY_COMMAND_METADATA` requires explicit review before it becomes an agent recommendation.
