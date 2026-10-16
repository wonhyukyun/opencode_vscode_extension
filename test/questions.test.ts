import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { questionAnswers, type QuestionDraft } from "../src/questionState"
import { QuestionResponder } from "../src/questionResponder"
import type { QuestionRequest } from "../src/types"

const request: QuestionRequest = {
  id: "q1", sessionID: "s1", questions: [
    { header: "Choice", question: "Which?", options: [{ label: "A", description: "" }, { label: "B", description: "" }] },
    { header: "Options", question: "What else?", multiple: true, custom: true, options: [{ label: "C", description: "" }] },
  ],
}

describe("question answers", () => {
  it("requires an explicit answer to every question", () => {
    const draft: QuestionDraft = { selected: [], custom: [], customSelected: [] }
    assert.deepEqual(questionAnswers(request, draft).missing, [0, 1])
  })
  it("preserves multiple choices and free text across serialized drafts", () => {
    const draft: QuestionDraft = { selected: [["B"], ["C"]], custom: ["", "  My answer  "], customSelected: [false, true] }
    const restored = JSON.parse(JSON.stringify(draft)) as QuestionDraft
    assert.deepEqual(questionAnswers(request, restored), { answers: [["B"], ["C", "My answer"]], missing: [] })
    assert.equal(restored.custom[1], "  My answer  ")
  })
  it("rejects blank custom answers even when another checkbox is selected", () => {
    const draft: QuestionDraft = { selected: [["A"], ["C"]], custom: ["", "  "], customSelected: [false, true] }
    assert.deepEqual(questionAnswers(request, draft).missing, [1])
  })
  it("rejects stale options and multiple answers to a single-choice question", () => {
    assert.deepEqual(questionAnswers(request, { selected: [["A", "B"], ["removed"]], custom: [], customSelected: [] }).missing, [0, 1])
  })
})

describe("question reply delivery", () => {
  it("does not resolve failed answers and allows retry", async () => {
    let attempts = 0
    const events: string[] = []
    const responder = new QuestionResponder(async () => ({
      replyQuestion: async () => { if (++attempts === 1) throw new Error("offline"); return true },
      rejectQuestion: async () => true,
    }), (event) => events.push(event.type))
    await responder.reply("q1", [["A"]])
    assert.deepEqual(events, ["questionSubmitting", "questionFailed"])
    await responder.reply("q1", [["A"]])
    assert.equal(events.at(-1), "questionResolved")
    assert.equal(attempts, 2)
  })
  it("suppresses duplicate submissions from two views", async () => {
    let finish!: (value: boolean) => void
    let calls = 0
    const responder = new QuestionResponder(async () => ({
      replyQuestion: () => { calls++; return new Promise<boolean>((resolve) => { finish = resolve }) },
      rejectQuestion: async () => true,
    }), () => {})
    const first = responder.reply("q1", [["A"]])
    await responder.reply("q1", [["B"]])
    assert.equal(calls, 1)
    finish(true)
    await first
  })
  it("keeps a failed skip retryable", async () => {
    const events: string[] = []
    const responder = new QuestionResponder(async () => ({
      replyQuestion: async () => true,
      rejectQuestion: async () => { throw new Error("timeout") },
    }), (event) => events.push(event.type))
    await responder.reply("q1")
    assert.deepEqual(events, ["questionSubmitting", "questionFailed"])
  })
})
