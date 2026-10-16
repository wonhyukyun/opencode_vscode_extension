import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parseFragment, type DefaultTreeAdapterMap } from "parse5"
import { formatModelValue, normalizeModelValue, parseModelValue } from "../src/modelRef"

/**
 * Reads an option value back the way a browser would. The previous separator looked fine as a
 * JavaScript string and only broke once the markup was parsed, so the round trip has to go through
 * a real HTML parser to be worth anything.
 */
function valueAfterHtmlParsing(value: string): string {
  const fragment = parseFragment(`<select><option value="${value}">label</option></select>`)
  const select = fragment.childNodes.find((node) => node.nodeName === "select") as DefaultTreeAdapterMap["element"]
  const option = select.childNodes.find((node) => node.nodeName === "option") as DefaultTreeAdapterMap["element"]
  return option.attrs.find((attribute) => attribute.name === "value")?.value ?? ""
}

describe("model picker values", () => {
  it("survives HTML parsing unchanged", () => {
    const value = formatModelValue("anthropic", "claude-sonnet-4-5")
    assert.equal(valueAfterHtmlParsing(value), value)
  })

  it("still parses after a round trip through HTML", () => {
    const value = formatModelValue("anthropic", "claude-sonnet-4-5")
    assert.deepEqual(parseModelValue(valueAfterHtmlParsing(value)), {
      providerID: "anthropic", modelID: "claude-sonnet-4-5",
    })
  })

  it("rejects the NUL separator that HTML destroys", () => {
    // Guards the actual defect: HTML turns U+0000 into U+FFFD, so the value could not be split.
    const broken = "anthropic\u0000claude-sonnet-4-5"
    assert.notEqual(valueAfterHtmlParsing(broken), broken)
    assert.equal(valueAfterHtmlParsing(broken).includes("�"), true)
    assert.equal(formatModelValue("anthropic", "claude-sonnet-4-5").includes("\u0000"), false)
  })

  it("keeps a slash inside a model id by splitting only at the first one", () => {
    const value = formatModelValue("openrouter", "meta-llama/llama-3.3-70b")
    assert.deepEqual(parseModelValue(value), {
      providerID: "openrouter", modelID: "meta-llama/llama-3.3-70b",
    })
    assert.equal(valueAfterHtmlParsing(value), value)
  })

  it("repairs a value saved by an older build", () => {
    assert.equal(normalizeModelValue("anthropic�claude-sonnet-4-5"), "anthropic/claude-sonnet-4-5")
    assert.equal(normalizeModelValue("anthropic\u0000claude-sonnet-4-5"), "anthropic/claude-sonnet-4-5")
    assert.deepEqual(parseModelValue("anthropic�claude-sonnet-4-5"), {
      providerID: "anthropic", modelID: "claude-sonnet-4-5",
    })
  })

  it("leaves a current value untouched when repairing", () => {
    assert.equal(normalizeModelValue("anthropic/claude-sonnet-4-5"), "anthropic/claude-sonnet-4-5")
  })

  it("reports nothing usable instead of half a selection", () => {
    for (const value of [undefined, "", "anthropic", "/model", "anthropic/"]) {
      assert.deepEqual(parseModelValue(value), {}, String(value))
      assert.equal(normalizeModelValue(value), undefined, String(value))
    }
  })
})
