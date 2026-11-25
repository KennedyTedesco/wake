// Runs the operations that change a repository one at a time, so two of them never race for
// `index.lock`. Reads do not queue.

export type MutationQueue = {
  run<T>(key: string, operation: () => Promise<T>): Promise<T>
  /** Whether an operation on `key` is running or waiting. */
  busy(key: string): boolean
}

export function createMutationQueue(): MutationQueue {
  const tails = new Map<string, Promise<unknown>>()
  const pending = new Map<string, number>()
  return {
    run(key, operation) {
      pending.set(key, (pending.get(key) ?? 0) + 1)
      const settle = async () => {
        try {
          return await operation()
        } finally {
          const left = (pending.get(key) ?? 1) - 1
          if (left > 0) pending.set(key, left)
          else {
            pending.delete(key)
            tails.delete(key)
          }
        }
      }
      const result = (tails.get(key) ?? Promise.resolve()).then(settle, settle)
      tails.set(
        key,
        result.catch(() => undefined)
      )
      return result
    },
    busy: (key) => pending.has(key)
  }
}
