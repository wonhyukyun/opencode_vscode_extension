import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { deleteHistory } from "../src/deleteHistory"

describe("history bulk deletion", () => {
  it("deletes only selected IDs and deduplicates them", async () => {
    const remaining = new Set(["a", "b", "c"])
    const result = await deleteHistory(["a", "c", "a"], async (id) => remaining.delete(id))
    assert.deepEqual(result, { deleted: ["a", "c"], failed: [] })
    assert.deepEqual([...remaining], ["b"])
  })
  it("continues after a failure and returns only failed IDs for retry", async () => {
    const calls: string[] = []
    const result = await deleteHistory(["a", "b", "c"], async (id) => {
      calls.push(id)
      if (id === "b") throw new Error("Chat is busy")
      return true
    })
    assert.deepEqual(calls, ["a", "b", "c"])
    assert.deepEqual(result.deleted, ["a", "c"])
    assert.deepEqual(result.failed, [{ id: "b", message: "Chat is busy" }])
    const retry = await deleteHistory(result.failed.map((item) => item.id), async () => true)
    assert.deepEqual(retry.deleted, ["b"])
  })
  it("treats an explicit false response as failure", async () => {
    const result = await deleteHistory(["a"], async () => false)
    assert.deepEqual(result.deleted, [])
    assert.equal(result.failed[0]?.id, "a")
  })
  it("does not call the engine for an empty selection", async () => {
    await deleteHistory([], async () => assert.fail("unexpected deletion"))
  })
})
