const BASE_MS = 500;
const MAX_MS = 30000;

export function nextDelay(attempt) {
  return Math.min(BASE_MS * 2 ** attempt, MAX_MS);
}
