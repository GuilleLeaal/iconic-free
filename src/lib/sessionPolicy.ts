export const SESSION_IDLE_MS = 60 * 60 * 1000;
export const SESSION_MAX_MS = 12 * 60 * 60 * 1000;
export const SESSION_WARNING_MS = 2 * 60 * 1000;

export type SessionExpiryReason = 'idle' | 'absolute';
export type SessionActivity = {
  sessionId: string;
  startedAt: number;
  lastActivityAt: number;
  expiredReason?: SessionExpiryReason;
};

export function readSessionActivity(value: string | null, sessionId: string): SessionActivity | null {
  if (!value) return null;
  try {
    const record = JSON.parse(value) as SessionActivity;
    if (record.sessionId !== sessionId || !Number.isFinite(record.startedAt) ||
      !Number.isFinite(record.lastActivityAt) || record.startedAt <= 0 ||
      record.lastActivityAt < record.startedAt ||
      (record.expiredReason !== undefined && !['idle', 'absolute'].includes(record.expiredReason))) return null;
    return record;
  } catch {
    return null;
  }
}

export function evaluateSession(activity: SessionActivity, now: number) {
  const absoluteDeadline = activity.startedAt + SESSION_MAX_MS;
  const idleDeadline = activity.lastActivityAt + SESSION_IDLE_MS;
  const reason: SessionExpiryReason = activity.expiredReason ??
    (absoluteDeadline <= idleDeadline ? 'absolute' : 'idle');
  const remainingMs = Math.min(absoluteDeadline, idleDeadline) - now;
  return {
    reason,
    expired: Boolean(activity.expiredReason) || remainingMs <= 0,
    warning: remainingMs <= SESSION_WARNING_MS,
    remainingSeconds: Math.max(0, Math.ceil(remainingMs / 1000)),
  };
}
