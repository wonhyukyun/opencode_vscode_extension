import type { QuestionRequest } from "./types"

export interface QuestionDraft {
  selected: string[][]
  custom: string[]
  customSelected: boolean[]
}

export function questionAnswers(request: QuestionRequest, draft: QuestionDraft): { answers: string[][]; missing: number[] } {
  const missing: number[] = []
  const answers = request.questions.map((question, index) => {
    const allowed = new Set(question.options.map((option) => option.label))
    const values = (draft.selected[index] ?? []).filter((value) => allowed.has(value))
    if (question.custom !== false && draft.customSelected[index]) {
      const text = draft.custom[index]?.trim()
      if (text) values.push(text)
      else missing.push(index)
    }
    if (!values.length || (!question.multiple && values.length !== 1)) missing.push(index)
    return [...new Set(values)]
  })
  return { answers, missing: [...new Set(missing)] }
}
