# Structured Facts

`kb/facts/` contains stable, machine-readable facts derived from the curated KB topics, preview documents, and raw evidence files.

These files are not an automatic ingestion layer. They are manually maintained and must remain source-aware.

## Files

- `environment.json`: board, OS, kernel, CPU, memory, and runtime baseline.
- `software_stack.json`: development tools, runtimes, package status, and install-risk boundaries.
- `network.json`: network interfaces, routing, DNS, and network risks.
- `storage_boot.json`: disk, partitions, mounts, boot arguments, and boot/storage warnings.
- `peripherals.json`: GPIO, I2C, SPI, UART, USB, DRM, audio, RTC, and PCI observations.
- `risks.json`: safety boundaries and unresolved high-risk areas.

## Fact Schema

Every fact entry must include:

```json
{
  "id": "environment.node.version",
  "value": "v14.16.1",
  "status": "measured",
  "confidence": "high",
  "last_updated": "2026-06-14",
  "sourceTopics": ["environment_report", "software_stack"],
  "sourcePaths": ["kb/environment_report.md", "kb/software_stack.md"],
  "rawEvidence": ["kb/environment_report.md", "kb/software_stack.md"],
  "unknowns": []
}
```

## Maintenance Rules

- Do not add a fact without `sourcePaths` and `rawEvidence`.
- Do not infer missing versions, hardware names, driver states, or install safety.
- Use `待确认` when evidence is not explicit.
- Current re-checks must be recorded as current evidence, not silently merged into historical facts.
- Preview documents and raw evidence are sources; do not edit preview package files to make facts pass.
