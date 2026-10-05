/** A listener event wins over an initial snapshot that may already be stale. */
export function createNetworkPathTracker<T extends string>() {
  let previous: T | undefined;
  let listenerObserved = false;
  return {
    seed(type: T | undefined) {
      if (!listenerObserved) previous = type;
    },
    record(type: T | undefined): boolean {
      listenerObserved = true;
      if (type === undefined) return false;
      const changed = previous === undefined || type !== previous;
      previous = type;
      return changed;
    },
  };
}
