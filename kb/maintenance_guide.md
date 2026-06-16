# Knowledge Maintenance Guide

## General Principle

The Loong Pi board is a read-only observation target for this task. Knowledge files are edited only in the local workspace copy, not on the board.

## Updating Facts

- Every new fact must include `sourcePaths` and `rawEvidence`.
- Every fact must include `id`, `value`, `status`, `confidence`, `last_updated`, `sourceTopics`, `sourcePaths`, `rawEvidence`, and `unknowns`.
- If evidence is incomplete, write `待确认`; do not infer versions, board identity, driver state, or install safety.
- Do not overwrite historical facts with current re-check output unless a new collection baseline is explicitly declared.

## Updating Topics

- Check raw evidence before changing a measured topic.
- Preserve `status`, `last_updated`, `sources`, `confidence`, `## Content`, and `## Unknowns`.
- If a topic conflicts with raw evidence, update the topic and cite the raw path in `sources` or the relevant fact.

## Unknowns

- Do not delete `unknowns`.
- Close an unknown only when evidence resolves it.
- If an unknown moves to a different topic or playbook, leave a traceable note.

## Preview And Raw Evidence

- Do not modify the preview package to make current docs pass tests.
- Do not put raw `.txt` files into default search.
- Use raw evidence for review, audit, and high-confidence claims.

## Commands And Safety

- `kb/command_reference.md` is human documentation and does not replace `READONLY_COMMAND_METADATA`.
- Do not write dangerous commands as agent-executable advice.
- Do not recommend `apt upgrade`, broad package installs, `fsck`, `fdisk`, `parted`, `mkfs`, `dd`, boot changes, network rewrites, or peripheral writes from KB evidence alone.
- 不默认执行任何会安装、升级、写盘、改配置、同步板端项目或改变外设状态的命令。

## Secrets

- Do not write `.env`, session secrets, API keys, tokens, or private credentials into KB files.
- Redact accidental secrets before adding evidence paths to public-facing docs.

## Board Synchronization

- Do not sync local KB changes back to `/home/loongson/loong-pi-agent` without separate explicit confirmation.
- Do not run `git pull`, `git reset`, `git checkout`, `rm`, `mv`, overwrite `cp`, `chmod`, `npm install`, `apt install`, `apt upgrade`, `fsck`, `fdisk`, `parted`, `mkfs`, or `dd` on the board as part of KB maintenance.
