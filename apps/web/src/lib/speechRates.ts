export const speechRates = [0.7, 1, 1.3] as const;

// Preserve the intent of previously saved preferences without rewriting history.
export function normalizeSpeechRate(value: unknown, fallback = 1): number {
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  const rate = Number(value);
  if (rate === 0.7 || rate === 0.8) return 0.7;
  if (rate === 0.9 || rate === 1 || rate === 1.1) return 1;
  if (rate === 1.2 || rate === 1.3) return 1.3;
  return fallback;
}
