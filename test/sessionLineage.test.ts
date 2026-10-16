import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { SessionLineage } from "../src/sessionLineage"

describe("session lineage", () => {
  it("matches the root itself and nested subagent sessions", async () => {
    const lineage = new SessionLineage(async () => undefined)
    lineage.remember({ id: "child", parentID: "root" })
    lineage.remember({ id: "grandchild", parentID: "child" })
    assert.equal(await lineage.belongsTo("root", "root"), true)
    assert.equal(await lineage.belongsTo("grandchild", "root"), true)
    assert.equal(await lineage.belongsTo("child", "other"), false)
  })
  it("looks up unknown sessions once and caches the answer", async () => {
    const calls: string[] = []
    const lineage = new SessionLineage(async (id) => {
      calls.push(id)
      return id === "child" ? { parentID: "root" } : {}
    })
    assert.equal(await lineage.belongsTo("child", "root"), true)
    assert.equal(await lineage.belongsTo("child", "root"), true)
    assert.deepEqual(calls, ["child"])
  })
  it("treats lookup failures and cycles as unrelated", async () => {
    const failing = new SessionLineage(async () => { throw new Error("gone") })
    assert.equal(await failing.belongsTo("x", "root"), false)
    const cyclic = new SessionLineage(async () => undefined)
    cyclic.remember({ id: "a", parentID: "b" })
    cyclic.remember({ id: "b", parentID: "a" })
    assert.equal(await cyclic.belongsTo("a", "root"), false)
  })
  it("rejects missing IDs", async () => {
    const lineage = new SessionLineage(async () => undefined)
    assert.equal(await lineage.belongsTo(undefined, "root"), false)
    assert.equal(await lineage.belongsTo("root", undefined), false)
  })
})
