# Troubleshooting Playbooks

`kb/playbooks/` contains executable-by-humans troubleshooting playbooks for recurring board issues.

Every playbook is evidence-first and read-only by default. It is not a repair script, not a package-install recipe, and not a board synchronization guide.

## Required Sections

Each playbook must include:

- `## 结论`
- `## 当前状态`
- `## 历史证据`
- `## 风险`
- `## 禁止操作`
- `## 允许的只读排查`
- `## 待确认`
- `## 证据路径`

## Maintenance Rules

- Keep commands read-only.
- Do not add `apt install`, `apt upgrade`, `fsck`, `fdisk`, `parted`, `mkfs`, `dd`, boot repairs, network rewrites, or peripheral writes as executable suggestions.
- Link each conclusion to topic, preview, or raw evidence.
- If evidence is incomplete, write `待确认` instead of guessing.
