import type { ProvidersResponse } from "./types"

/**
 * The model picker stores a provider and a model id in one `<option value>`. Building that string
 * and taking it apart live here together, because a mismatch between the two is silent: the picker
 * keeps showing the chosen model while every prompt goes out with no model at all.
 *
 * The separator must survive HTML parsing. An earlier version used U+0000, which the HTML tokenizer
 * replaces with U+FFFD, so nothing could be parsed back out. A model id may itself contain a
 * slash, so the value is split at the first one only.
 */
export const MODEL_VALUE_SEPARATOR = "/"

/** Separators written by older builds, still present in saved workspace preferences. */
const LEGACY_SEPARATORS = ["\u0000", "�"]

export interface ParsedModelValue {
  providerID?: string
  modelID?: string
}

export function formatModelValue(providerID: string, modelID: string): string {
  return `${providerID}${MODEL_VALUE_SEPARATOR}${modelID}`
}

/**
 * Splits a picker value back into its provider and model. Values saved by older builds used a
 * separator that HTML mangled, so those are accepted too and callers get the repaired form.
 */
export function parseModelValue(value: string | undefined): ParsedModelValue {
  if (!value) return {}
  for (const separator of LEGACY_SEPARATORS) {
    const index = value.indexOf(separator)
    if (index > 0) {
      const providerID = value.slice(0, index)
      const modelID = value.slice(index + separator.length)
      return modelID ? { providerID, modelID } : {}
    }
  }
  const index = value.indexOf(MODEL_VALUE_SEPARATOR)
  if (index <= 0) return {}
  const providerID = value.slice(0, index)
  const modelID = value.slice(index + MODEL_VALUE_SEPARATOR.length)
  return modelID ? { providerID, modelID } : {}
}

/**
 * Rewrites a value saved by an older build into the current form. Returns undefined when the value
 * cannot be parsed at all, so a stale preference is dropped rather than silently selecting nothing.
 */
export function normalizeModelValue(value: string | undefined): string | undefined {
  const { providerID, modelID } = parseModelValue(value)
  return providerID && modelID ? formatModelValue(providerID, modelID) : undefined
}

export interface ConfiguredDefault {
  /** Picker value to select, when the setting names a model this workspace actually has. */
  value?: string
  /** Why the setting was ignored, shown as a notice. An empty setting produces neither field. */
  problem?: string
}

const SETTING = "opencodeIntegrated.defaultModel"

/**
 * Resolves the `opencodeIntegrated.defaultModel` setting against the models the engine reports.
 * A setting naming a model that is not available is reported rather than quietly dropped, because
 * silently falling back looks exactly like the setting doing nothing.
 */
export function resolveConfiguredDefault(
  setting: string | undefined, providers: ProvidersResponse | undefined,
): ConfiguredDefault {
  const trimmed = (setting ?? "").trim()
  if (!trimmed) return {}
  const { providerID, modelID } = parseModelValue(trimmed)
  if (!providerID || !modelID) {
    return { problem: `${SETTING} must be in provider/model form. "${trimmed}" is not.` }
  }
  const provider = providers?.providers?.find((item) => item.id === providerID)
  if (!provider) {
    return { problem: `${SETTING} names provider "${providerID}", which this workspace does not have.` }
  }
  if (!provider.models?.[modelID]) {
    return { problem: `${SETTING} names model "${modelID}", which provider "${providerID}" does not offer.` }
  }
  return { value: formatModelValue(providerID, modelID) }
}
