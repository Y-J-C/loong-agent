# Peripheral Interfaces

status: sourced
last_updated: 2026-07-06
sources: kb/book_dev_workflows_reference.md; kb/board_profile.md; kb/environment_report.md; kb/facts/peripherals.json; kb/playbooks/gpio-i2c-spi-uart.md; kb/playbooks/serial-communication.md
confidence: medium

## Content

Peripheral knowledge in Phase D is intentionally conservative. The existing KB records some device nodes and serial interface observations, but GPIO/PWM/camera functional use remains `book_reference + needs_board_check` unless a future board test upgrades a specific item.

Allowed guidance is read-only:

- List visible nodes and permissions.
- Check kernel logs for driver or enumeration messages.
- Compare requested interface with known board identity and existing verified facts.
- Route UART and serial communication questions through `serial-communication.md` when relevant.

Forbidden by default:

- Writing GPIO or PWM values.
- Performing wiring, voltage, pinmux, or bus probing tests.
- Capturing from camera devices or assuming `/dev/video*` exists.
- Treating OpenCV, libmodbus, Qt, or camera tools as installed by default.

## Unknowns

- Safe GPIO and PWM pin mapping.
- PWM node availability and output behavior.
- Camera device node, driver, and supported format.
- External wiring, voltage level, and bus termination.
- Whether project dependencies such as OpenCV or libmodbus are installed.
