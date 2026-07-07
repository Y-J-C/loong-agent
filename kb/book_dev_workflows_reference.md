# Book Development Workflows Reference

status: sourced
last_updated: 2026-07-06
sources: user-provided book outline; kb/book_first_platform_reference.md; kb/build_guide.md; kb/loongarch_isa.md; kb/software_stack.md; kb/compatibility_matrix.md
confidence: medium

## Content

This source note records the Phase D intake boundary for book-derived development workflows. It covers cross compilation, GCC/CMake build failures, dynamic library diagnosis, Python venv handling, GPIO/PWM/camera interfaces, Modbus communication, and camera/OpenCV project patterns.

All Phase D entries derived from this note are `book_reference + needs_board_check`. They are searchable diagnostic templates, not current board facts. Current board facts must still come from verified KB such as `kb/board_profile.md`, `kb/environment_report.md`, `kb/software_stack.md`, `kb/compatibility_matrix.md`, `kb/build_guide.md`, and existing verified playbooks.

Allowed intake:

- Architecture and ABI boundary reminders for `loongarch64`, `mips64el`, sysroot, and toolchain prefix mixing.
- Read-only diagnosis for compiler target, build tool versions, missing headers, disk pressure, memory pressure, and dynamic library linkage.
- Read-only diagnosis for Python runtime, `pip3`, user-local package paths, and venv availability.
- Read-only observation patterns for GPIO, PWM, camera, serial/Modbus, and camera/OpenCV projects.
- Warnings that Qt, OpenCV, libmodbus, GPIO, PWM, and camera usability must not be treated as currently verified.

Not allowed as current facts:

- Qt/OpenCV/libmodbus installed or usable by default.
- GPIO/PWM/camera functional output or electrical safety.
- A working cross toolchain, sysroot, or vendor SDK path.
- Direct install, download, package upgrade, wiring, GPIO/PWM write, camera capture, Modbus traffic, or system library modification steps.

## Unknowns

- Current board cross toolchain and sysroot paths are not verified.
- Current GPIO/PWM pin mapping, voltage, mux state, and safe electrical procedure are not verified.
- Current camera node, driver, and OpenCV availability are not verified.
- Current libmodbus installation and project wiring are not verified.
- Current Python venv behavior on the board remains needs_board_check.
