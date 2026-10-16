import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { summarizeTokens } from "../src/tokens"
import type { MessageWithParts } from "../src/types"

const zero = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
const usage = (input: number, output: number) => ({ input, output, reasoning: 0, cache: { read: 0, write: 0 } })

function assistant(id: string, tokens: unknown, parts: MessageWithParts["parts"] = []): MessageWithParts {
  return { info: { id, sessionID: "s", role: "assistant", time: { created: 1 }, tokens, providerID: "p", modelID: "m" }, parts }
}

describe("token summary", () => {
  it("ignores a trailing assistant message whose counters are still zero", () => {
    const summary = summarizeTokens([assistant("a", usage(100, 20)), assistant("b", zero)])
    assert.equal(summary?.context, 120)
    assert.equal(summary?.sessionTotal, 120)
  })

  it("falls back to step-finish part usage when info.tokens is empty", () => {
    const summary = summarizeTokens([
      assistant("a", zero, [{ id: "p", sessionID: "s", messageID: "a", type: "step-finish", tokens: usage(50, 5) }]),
    ])
    assert.equal(summary?.context, 55)
    assert.equal(summary?.providerID, "p")
  })

  it("adds an estimate for a streaming assistant turn without usage", () => {
    const streaming = assistant("b", zero, [
      { id: "t", sessionID: "s", messageID: "b", type: "text", text: "x".repeat(400) },
      { id: "r", sessionID: "s", messageID: "b", type: "reasoning", text: "y".repeat(40) },
    ])
    const summary = summarizeTokens([assistant("a", usage(100, 20)), streaming])
    assert.equal(summary?.pending, 110)
    assert.equal(summary?.context, 230)
    assert.equal(summary?.sessionTotal, 120)
  })

  it("returns undefined when nothing has usage", () => {
    assert.equal(summarizeTokens([assistant("a", zero), assistant("b", undefined)]), undefined)
  })
})
