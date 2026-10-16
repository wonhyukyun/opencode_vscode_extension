import type { ModelInfo, ProvidersResponse } from "./types"

export interface ModelRef {
  providerID?: string
  modelID?: string
  variant?: string
}

export interface ResolvedContextWindow {
  /** Context window in tokens, or undefined when the engine reports none for this model. */
  limit?: number
  /** Display name of the model the window belongs to. */
  modelName?: string
  /** Variant that supplied the window, set only when it overrode the model default. */
  variant?: string
  /** True when the window came from the model that produced the latest reply, not the picker. */
  fromPreviousTurn: boolean
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Reads a context window out of a variant definition. Variants are open records in the engine, so
 * a provider or an `opencode.json` entry may spell the window `limit.context`, `context`, or
 * `contextWindow`. A variant without any of those keeps the model default.
 */
export function variantContextLimit(variant: unknown): number | undefined {
  if (!variant || typeof variant !== "object") return undefined
  const record = variant as Record<string, unknown>
  const limit = record.limit
  if (limit && typeof limit === "object") {
    const nested = positiveNumber((limit as Record<string, unknown>).context)
    if (nested) return nested
  }
  return positiveNumber(record.context) ?? positiveNumber(record.contextWindow)
}

/**
 * Formats a context window compactly without blurring models together. The usage formatter rounds
 * to one decimal, which renders 1,000,000 and 1,048,576 both as "1.0M" and makes every wide model
 * look identical; this keeps two decimals and trims trailing zeros, so those read "1M" and "1.05M".
 */
export function formatContextWindow(value: number): string {
  const scale = (divisor: number, decimals: number, suffix: string): string =>
    `${Number((value / divisor).toFixed(decimals))}${suffix}`
  if (value >= 1_000_000) return scale(1_000_000, 2, "M")
  if (value >= 1_000) return scale(1_000, 1, "K")
  return String(value)
}

export function findModel(
  providers: ProvidersResponse | undefined, providerID?: string, modelID?: string,
): ModelInfo | undefined {
  if (!providerID || !modelID) return undefined
  return providers?.providers?.find((provider) => provider.id === providerID)?.models?.[modelID]
}

function windowOf(model: ModelInfo, variant?: string): { limit?: number; variant?: string } {
  const override = variant ? variantContextLimit(model.variants?.[variant]) : undefined
  if (override) return { limit: override, variant }
  return { limit: positiveNumber(model.limit?.context) }
}

/**
 * Works out which context window to display. The model chosen in the picker wins, because that is
 * the model the next prompt will run against; the model that produced the latest reply is the
 * fallback for a picker that has not resolved yet. A selected variant may widen or narrow the
 * window, so it is applied on top of the model default.
 */
export function resolveContextWindow(options: {
  providers?: ProvidersResponse
  /** Provider, model, and variant currently chosen in the picker. */
  selected?: ModelRef
  /** Provider and model of the most recent assistant turn, when the session has one. */
  turn?: ModelRef
}): ResolvedContextWindow {
  const { providers, selected, turn } = options
  const candidates: { ref: ModelRef; fromPreviousTurn: boolean }[] = []
  if (selected?.providerID && selected.modelID) candidates.push({ ref: selected, fromPreviousTurn: false })
  if (turn?.providerID && turn.modelID) {
    const sameAsSelected = turn.providerID === selected?.providerID && turn.modelID === selected?.modelID
    candidates.push({ ref: turn, fromPreviousTurn: !sameAsSelected })
  }

  let named: ResolvedContextWindow | undefined
  for (const candidate of candidates) {
    const model = findModel(providers, candidate.ref.providerID, candidate.ref.modelID)
    if (!model) continue
    const resolved = windowOf(model, candidate.ref.variant)
    const modelName = model.name || model.id
    if (!resolved.limit) {
      named ??= { modelName, fromPreviousTurn: candidate.fromPreviousTurn }
      continue
    }
    return { limit: resolved.limit, modelName, variant: resolved.variant, fromPreviousTurn: candidate.fromPreviousTurn }
  }
  return named ?? { fromPreviousTurn: false }
}
