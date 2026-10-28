import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { isTermux, ensureTermuxCli } from "../../src/services/cli-backend/termux"

describe("isTermux", () => {
  it("detects via TERMUX_VERSION", () => {
    expect(isTermux({ TERMUX_VERSION: "0.118", PREFIX: "" })).toBe(true)
  })

  it("detects via com.termux PREFIX", () => {
    expect(isTermux({ TERMUX_VERSION: "", PREFIX: "/data/data/com.termux/files/usr" })).toBe(true)
  })

  it("is false without Termux markers", () => {
    expect(isTermux({ TERMUX_VERSION: "", PREFIX: "/usr" })).toBe(false)
  })
})

describe("ensureTermuxCli", () => {
  let dir: string
  let cliPath: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-termux-"))
    cliPath = path.join(dir, "kilo")
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("returns unchanged when binary is missing", async () => {
    expect(ensureTermuxCli(cliPath)).toBe(cliPath)
  })

  it("is idempotent for an already-prepared wrapper", async () => {
    await fs.writeFile(cliPath, "#!/bin/sh\nexec env -u LD_PRELOAD loader bin\n")
    expect(ensureTermuxCli(cliPath)).toBe(cliPath)
    const content = await fs.readFile(cliPath, "utf8")
    expect(content.startsWith("#!/bin/sh")).toBe(true)
  })

  it("bridges an ELF binary: copies to kilo.bin and writes a loader wrapper", async () => {
    await fs.writeFile(cliPath, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x00]))
    const loader = "/data/data/com.termux/files/usr/glibc/lib/ld-linux-aarch64.so.1"
    const loaderOk = await fs
      .access(loader)
      .then(() => true)
      .catch(() => false)
    if (!loaderOk) {
      // No glibc runtime on this host: expect the actionable error instead.
      expect(() => ensureTermuxCli(cliPath)).toThrow(/glibc runtime missing/)
      return
    }

    const result = ensureTermuxCli(cliPath)
    expect(result).toBe(cliPath)
    const content = await fs.readFile(cliPath, "utf8")
    expect(content).toContain("LD_PRELOAD")
    expect(content).toContain("--library-path")
    expect(content).toContain("kilo.bin")
    const bin = await fs.readFile(path.join(dir, "kilo.bin"))
    expect(bin.subarray(0, 4).toString()).toBe(Buffer.from([0x7f, 0x45, 0x4c, 0x46]).toString())
    const link = await fs.readlink(path.join(dir, "kilo-runtime", "kilo"))
    expect(link).toContain("glibc")
  })
})
