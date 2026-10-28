---
"@kilocode/cli": patch
---

Install natively on Android/Termux. The installer now detects Termux and runs the official `kilo-linux-arm64` binary through Termux's native glibc runtime (via the `glibc` package) — no proot, no patched ELF.
