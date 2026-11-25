const storageKey = "lab-review-request";
const inflight = new Map<string, Promise<unknown>>();

type SavedRequest = { slot: string; body: Record<string, unknown> };

function readSaved(slot: string) {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedRequest;
    return saved.slot === slot ? saved.body : null;
  } catch {
    return null;
  }
}

function writeSaved(slot: string, body: Record<string, unknown>) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify({ slot, body }));
  } catch {
    // 隐私模式没有会话存储时，这次点击仍然带上内存中的请求号。
  }
}

function clearSaved(slot: string) {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return;
    const saved = JSON.parse(raw) as SavedRequest;
    if (saved.slot === slot) sessionStorage.removeItem(storageKey);
  } catch {
    sessionStorage.removeItem(storageKey);
  }
}

function samePayload(saved: Record<string, unknown>, payload: Record<string, unknown>) {
  const previous = { ...saved };
  delete previous.clientRequestId;
  const keys = new Set([...Object.keys(previous), ...Object.keys(payload)]);
  for (const key of keys) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(payload[key])) return false;
  }
  return true;
}

export function progressStamp(source: {
  due?: string | number | null;
  reps?: number;
  lapses?: number;
  state?: number;
  lastReview?: string | number | null;
  correctCount?: number;
  incorrectCount?: number;
}) {
  return {
    due: source.due ?? null,
    reps: source.reps ?? 0,
    lapses: source.lapses ?? 0,
    state: source.state ?? 0,
    lastReview: source.lastReview ?? null,
    correctCount: source.correctCount ?? 0,
    incorrectCount: source.incorrectCount ?? 0,
  };
}
export function withReviewRequest<T>(slot: string, payload: Record<string, unknown>, send: (body: Record<string, unknown>) => Promise<T>) {
  const current = inflight.get(slot);
  if (current) return current as Promise<T>;
  const saved = readSaved(slot);
  const body = saved && samePayload(saved, payload) ? saved : { ...payload, clientRequestId: crypto.randomUUID() };
  writeSaved(slot, body);
  const task = send(body)
    .then((result) => {
      clearSaved(slot);
      return result;
    })
    .finally(() => {
      inflight.delete(slot);
    });
  inflight.set(slot, task);
  return task;
}
