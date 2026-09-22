import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { executableName, platformTarget } from "../src/binary"

describe("bundled binary mapping", () => {
  it("maps supported VS Code hosts to target folders", () => {
    assert.equal(platformTarget("win32", "x64"), "win32-x64")
    assert.equal(platformTarget("darwin", "arm64"), "darwin-arm64")
    assert.equal(platformTarget("linux", "x64"), "linux-x64")
  })

  it("uses the Windows executable suffix only on Windows", () => {
    assert.equal(executableName("win32"), "opencode.exe")
    assert.equal(executableName("linux"), "opencode")
  })
})
