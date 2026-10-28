import * as fs from "fs"
import * as path from "path"

const TERMUX_PREFIX = "/data/data/com.termux/files/usr"
const WRAPPER_PREFIX = "#!/bin/sh"

export function isTermux(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.TERMUX_VERSION != null) return true
  if (env.PREFIX?.includes("/com.termux/")) return true
  return process.platform === "linux" && fs.existsSync(path.join(TERMUX_PREFIX, "glibc/lib/libc.so.6"))
}

function glibcLoader(): string {
  return path.join(
    TERMUX_PREFIX,
    "glibc/lib",
    process.arch === "x64" ? "ld-linux-x86-64.so.2" : "ld-linux-aarch64.so.1",
  )
}

// The bundled kilo binary is glibc-linked and cannot run on Android bionic.
// Rename it to kilo.bin once, then replace bin/kilo with a wrapper that execs
// it through Termux's glibc loader (the `pkg install glibc` package provides
// $PREFIX/glibc/lib). LD_PRELOAD must be unset: Termux preloads the bionic
// libtermux-exec, which crashes the glibc loader. The loader is exec'd via a
// symlink named "kilo" so comm stays "kilo" for tools matching by process
// name. Never rewrite the ELF interpreter — patchelf segfaults bun binaries.
// Idempotent: a prepared wrapper starts with the "#!/bin/sh" sentinel.
export function ensureTermuxCli(cliPath: string): string {
  if (!fs.existsSync(cliPath)) return cliPath

  const fd = fs.openSync(cliPath, "r")
  const buf = Buffer.alloc(WRAPPER_PREFIX.length)
  const read = fs.readSync(fd, buf, 0, buf.length, 0)
  fs.closeSync(fd)
  if (buf.subarray(0, read).toString() === WRAPPER_PREFIX) return cliPath

  const loader = glibcLoader()
  if (!fs.existsSync(loader)) {
    throw new Error(
      `Termux glibc runtime missing (${loader}). Run 'pkg install -y glibc' in Termux and reload the window.`,
    )
  }
  const bin = path.join(path.dirname(cliPath), "kilo.bin")
  if (path.resolve(cliPath) !== path.resolve(bin)) {
    fs.copyFileSync(cliPath, bin)
    fs.chmodSync(bin, 0o755)
  }
  const runtime = path.join(path.dirname(cliPath), "kilo-runtime")
  fs.mkdirSync(runtime, { recursive: true })
  fs.symlinkSync(loader, path.join(runtime, "kilo"))
  const wrapper = [
    WRAPPER_PREFIX,
    `exec env -u LD_PRELOAD "${path.join(runtime, "kilo")}" \\`,
    `  --library-path "${TERMUX_PREFIX}/glibc/lib" \\`,
    `  "${bin}" "$@"`,
    "",
  ].join("\n")
  fs.writeFileSync(cliPath, wrapper)
  fs.chmodSync(cliPath, 0o755)
  return cliPath
}
