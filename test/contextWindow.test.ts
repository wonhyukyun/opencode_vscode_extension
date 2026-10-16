import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { formatContextWindow, resolveContextWindow, variantContextLimit } from "../src/contextWindow"
import type { ProvidersResponse } from "../src/types"

const providers: ProvidersResponse = {
  default: {},
  providers: [
    {
      id: "anthropic",
      name: "Anthropic",
      models: {
        sonnet: {
          id: "sonnet", providerID: "anthropic", name: "Claude Sonnet",
          limit: { context: 200_000, output: 64_000 },
          variants: { long: { limit: { context: 1_000_000 } }, high: { reasoningEffort: "high" } },
        },
        haiku: {
          id: "haiku", providerID: "anthropic", name: "Claude Haiku",
          limit: { context: 200_000, output: 32_000 },
        },
      },
    },
    {
      id: "opencode",
      name: "OpenCode",
      models: {
        nemotron: {
          id: "nemotron", providerID: "opencode", name: "Nemotron Ultra",
          limit: { context: 1_000_000, output: 128_000 },
        },
        unknown: { id: "unknown", providerID: "opencode", name: "Unknown" },
      },
    },
  ],
}

describe("context window resolution", () => {
  it("reports the window of the model chosen in the picker", () => {
    const window = resolveContextWindow({ providers, selected: { providerID: "anthropic", modelID: "sonnet" } })
    assert.equal(window.limit, 200_000)
    assert.equal(window.modelName, "Claude Sonnet")
    assert.equal(window.fromPreviousTurn, false)
  })

  it("changes with the selected model rather than staying on one number", () => {
    const wide = resolveContextWindow({ providers, selected: { providerID: "opencode", modelID: "nemotron" } })
    const narrow = resolveContextWindow({ providers, selected: { providerID: "anthropic", modelID: "haiku" } })
    assert.equal(wide.limit, 1_000_000)
    assert.equal(narrow.limit, 200_000)
  })

  it("prefers the picker over the model that produced the last reply", () => {
    const window = resolveContextWindow({
      providers,
      selected: { providerID: "anthropic", modelID: "haiku" },
      turn: { providerID: "opencode", modelID: "nemotron" },
    })
    assert.equal(window.limit, 200_000)
    assert.equal(window.modelName, "Claude Haiku")
    assert.equal(window.fromPreviousTurn, false)
  })

  it("falls back to the last reply's model and flags it when the picker has no selection", () => {
    const window = resolveContextWindow({ providers, turn: { providerID: "opencode", modelID: "nemotron" } })
    assert.equal(window.limit, 1_000_000)
    assert.equal(window.fromPreviousTurn, true)
  })

  it("does not flag the previous turn when it used the selected model", () => {
    const window = resolveContextWindow({
      providers,
      selected: { providerID: "anthropic", modelID: "sonnet" },
      turn: { providerID: "anthropic", modelID: "sonnet" },
    })
    assert.equal(window.fromPreviousTurn, false)
  })

  it("lets a variant widen the window of the same model", () => {
    const window = resolveContextWindow({
      providers, selected: { providerID: "anthropic", modelID: "sonnet", variant: "long" },
    })
    assert.equal(window.limit, 1_000_000)
    assert.equal(window.variant, "long")
  })

  it("keeps the model default for a variant that only sets reasoning effort", () => {
    const window = resolveContextWindow({
      providers, selected: { providerID: "anthropic", modelID: "sonnet", variant: "high" },
    })
    assert.equal(window.limit, 200_000)
    assert.equal(window.variant, undefined)
  })

  it("names the model even when no window is reported", () => {
    const window = resolveContextWindow({ providers, selected: { providerID: "opencode", modelID: "unknown" } })
    assert.equal(window.limit, undefined)
    assert.equal(window.modelName, "Unknown")
  })

  it("uses the last reply's window when the selected model reports none", () => {
    const window = resolveContextWindow({
      providers,
      selected: { providerID: "opencode", modelID: "unknown" },
      turn: { providerID: "anthropic", modelID: "haiku" },
    })
    assert.equal(window.limit, 200_000)
    assert.equal(window.modelName, "Claude Haiku")
  })

  it("returns nothing usable for an unknown provider", () => {
    const window = resolveContextWindow({ providers, selected: { providerID: "nope", modelID: "nope" } })
    assert.deepEqual(window, { fromPreviousTurn: false })
  })

  it("reads a window from the shapes a variant may use, and ignores junk", () => {
    assert.equal(variantContextLimit({ limit: { context: 500 } }), 500)
    assert.equal(variantContextLimit({ context: 400 }), 400)
    assert.equal(variantContextLimit({ contextWindow: 300 }), 300)
    assert.equal(variantContextLimit({ context: 0 }), undefined)
    assert.equal(variantContextLimit({ context: "big" }), undefined)
    assert.equal(variantContextLimit(undefined), undefined)
  })

  it("keeps windows of similar size apart instead of showing them all as 1M", () => {
    assert.equal(formatContextWindow(1_000_000), "1M")
    assert.equal(formatContextWindow(1_048_576), "1.05M")
    assert.equal(formatContextWindow(2_000_000), "2M")
    assert.equal(formatContextWindow(262_144), "262.1K")
    assert.equal(formatContextWindow(200_000), "200K")
    assert.equal(formatContextWindow(900), "900")
  })
})
