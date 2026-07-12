// The one-time state-snapshot pull and the live transcript push are two
// independent async writers of `entries` with no ordering guarantee between
// them - merging (keyed by speakerId+receivedAt, deduped, time-sorted) makes
// the result immune to which one resolves last. An unconditional overwrite
// here previously let a late-resolving snapshot erase an already-appended
// live message, which looked like the message vanishing immediately.
export function mergeEntries(current, incoming) {
  const merged = new Map();
  for (const entry of current) merged.set(`${entry.speakerId}-${entry.receivedAt}`, entry);
  for (const entry of incoming) merged.set(`${entry.speakerId}-${entry.receivedAt}`, entry);
  return [...merged.values()].sort((a, b) => a.receivedAt - b.receivedAt);
}
