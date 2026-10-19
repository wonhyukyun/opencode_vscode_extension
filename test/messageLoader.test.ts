import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { loadLatestMessages } from "../src/messageLoader"

describe("latest message loading", () => {
  it("loads the full count when the engine can", async () => {
    const calls: number[] = []
    const result = await loadLatestMessages(async (limit) => { calls.push(limit); return ["m"] })
    assert.deepEqual(calls, [200])
    assert.deepEqual(result, { messages: ["m"], limit: 200 })
  })
  it("retries with fewer messages after an engine failure", async () => {
    const calls: number[] = []
    const result = await loadLatestMessages(async (limit) => {
      calls.push(limit)
      if (limit > 10) throw new Error("RangeError: Out of memory")
      return ["m"]
    })
    assert.deepEqual(calls, [200, 50, 10])
    assert.deepEqual(result, { messages: ["m"], limit: 10, error: "RangeError: Out of memory" })
  })
  it("returns no messages and the error when every attempt fails", async () => {
    const result = await loadLatestMessages(async () => { throw new Error("boom") })
    assert.deepEqual(result, { messages: [], error: "boom" })
  })
})
