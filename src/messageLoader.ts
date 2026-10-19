/** Message counts to try, largest first, when a chat is too large for the engine to send at once. */
export const MESSAGE_LOAD_LIMITS = [200, 50, 10] as const

export interface LoadedMessages<T> {
  messages: T[]
  /** The limit that succeeded, or undefined when every attempt failed. */
  limit?: number
  /** The last failure, set when the full count could not be loaded. */
  error?: string
}

/**
 * Loads a chat's latest messages, retrying with fewer when the engine fails. A chat holding huge
 * tool output or images can make the engine answer with "RangeError: Out of memory"; without a
 * fallback that one chat breaks startup and New chat, since both load the remembered chat first.
 */
export async function loadLatestMessages<T>(
  fetch: (limit: number) => Promise<T[]>,
  limits: readonly number[] = MESSAGE_LOAD_LIMITS,
): Promise<LoadedMessages<T>> {
  let error: string | undefined
  for (const limit of limits) {
    try {
      const messages = await fetch(limit)
      return error ? { messages, limit, error } : { messages, limit }
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure)
    }
  }
  return { messages: [], error }
}
