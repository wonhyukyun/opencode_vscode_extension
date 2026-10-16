import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { resolveConfiguredDefault } from "../src/modelRef"
import type { ProvidersResponse } from "../src/types"

const providers: ProvidersResponse = {
  default: { anthropic: "haiku" },
  providers: [
    {
      id: "anthropic",
      name: "Anthropic",
      models: {
        sonnet: { id: "sonnet", providerID: "anthropic", name: "Claude Sonnet" },
        haiku: { id: "haiku", providerID: "anthropic", name: "Claude Haiku" },
      },
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      models: {
        "meta-llama/llama-3.3-70b": {
          id: "meta-llama/llama-3.3-70b", providerID: "openrouter", name: "Llama 3.3 70B",
        },
      },
    },
  ],
}

describe("opencodeIntegrated.defaultModel setting", () => {
  it("resolves a model the workspace has", () => {
    assert.deepEqual(resolveConfiguredDefault("anthropic/sonnet", providers), { value: "anthropic/sonnet" })
  })

  it("ignores surrounding whitespace", () => {
    assert.deepEqual(resolveConfiguredDefault("  anthropic/sonnet  ", providers), { value: "anthropic/sonnet" })
  })

  it("handles a model id that itself contains a slash", () => {
    assert.deepEqual(resolveConfiguredDefault("openrouter/meta-llama/llama-3.3-70b", providers), {
      value: "openrouter/meta-llama/llama-3.3-70b",
    })
  })

  it("stays silent when the setting is empty", () => {
    for (const value of ["", "   ", undefined]) {
      assert.deepEqual(resolveConfiguredDefault(value, providers), {}, String(value))
    }
  })

  it("explains a setting that is not in provider/model form", () => {
    const result = resolveConfiguredDefault("sonnet", providers)
    assert.equal(result.value, undefined)
    assert.match(result.problem ?? "", /provider\/model form/)
  })

  it("explains an unknown provider", () => {
    const result = resolveConfiguredDefault("openai/gpt-5", providers)
    assert.equal(result.value, undefined)
    assert.match(result.problem ?? "", /provider "openai"/)
  })

  it("explains a model the provider does not offer", () => {
    const result = resolveConfiguredDefault("anthropic/opus", providers)
    assert.equal(result.value, undefined)
    assert.match(result.problem ?? "", /model "opus"/)
  })

  it("reports a problem rather than resolving when providers are not loaded yet", () => {
    const result = resolveConfiguredDefault("anthropic/sonnet", undefined)
    assert.equal(result.value, undefined)
    assert.equal(typeof result.problem, "string")
  })
})
