// TX-06: records saved while offline are kept on this device, per person, and sent when the connection returns.
// Only the record itself is kept (no password, no token). Damaged or oversized data is ignored, never trusted.

export interface QueuedRow {
  /** A temporary id, "queued-…", until the server gives the record its real one. */
  tempId: string;
  kind: 'expense' | 'income';
  row: Record<string, unknown>;
  createdAt: string;
}

const MAX_ITEMS = 500;
const keyFor = (userId: string) => `ve_pending_${userId}`;

const isRow = (value: unknown): value is QueuedRow => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.tempId === 'string' && item.tempId.startsWith('queued-') && (item.kind === 'expense' || item.kind === 'income') && typeof item.createdAt === 'string' && Boolean(item.row) && typeof item.row === 'object';
};

export function readQueue(userId: string): QueuedRow[] {
  if (!userId) return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(keyFor(userId)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isRow).slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

function write(userId: string, list: QueuedRow[]) {
  try {
    if (list.length === 0) localStorage.removeItem(keyFor(userId));
    else localStorage.setItem(keyFor(userId), JSON.stringify(list.slice(0, MAX_ITEMS)));
  } catch {
    /* storage full or blocked: the record could not be kept; the caller already told the person */
  }
}

export function enqueue(userId: string, item: Omit<QueuedRow, 'tempId'>): QueuedRow {
  const entry: QueuedRow = { ...item, tempId: `queued-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` };
  write(userId, [...readQueue(userId), entry]);
  return entry;
}

export function removeFromQueue(userId: string, tempId: string) {
  write(userId, readQueue(userId).filter((item) => item.tempId !== tempId));
}

export function clearQueue(userId: string) {
  write(userId, []);
}
