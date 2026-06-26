# Glossary

## Agent topic

A root `kb/*.md` summary file that the agent can read as a runtime entrypoint. The current root topics include board, environment, software stack, compatibility, risk, command reference, source index, and unknowns.

## Maintenance doc

A KB document used by maintainers rather than as the primary runtime answer source. Examples include `kb/README.md`, `kb/troubleshooting.md`, `kb/stage_status.md`, `kb/evidence_map.md`, and `kb/maintenance_guide.md`.

## Structured fact

A machine-readable JSON fact under `kb/facts/`. Each fact must carry source paths, raw evidence paths, status, confidence, and unknowns.

## Archived source

A historical source category that is no longer part of the active compact knowledge layout. Do not use archived paths as active source paths.

## Raw evidence

Original command output or logs, usually under `kb/evidence_map.md`. Raw `.txt` files are excluded from default full-text search and are used for evidence review.

## Baseline

The measured snapshot represented by current KB topics and raw evidence. A fresh board re-check is not automatically a new baseline unless the collection baseline is intentionally upgraded.

## Unknown

A known gap that must remain visible until closed or moved. Unknowns must not be deleted simply because they are inconvenient.

## Runtime available

A command, module, or runtime was observed to work through `which`, version output, or module import evidence.

## Installed

Package-manager evidence shows the package is installed. `runtime available` and `installed` are related but not interchangeable.

## Apt candidate exists

APT reports a candidate version. This does not mean the tool is installed, usable, safe to install, or low-cost.

## Missing

Runtime or package evidence shows the command/package is not present in the current snapshot.

## 待确认

The evidence is insufficient for a confirmed fact. Use this value instead of guessing.
