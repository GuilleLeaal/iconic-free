import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { evaluateSession, readSessionActivity } from '../lib/sessionPolicy';
import type { SessionActivity, SessionExpiryReason } from '../lib/sessionPolicy';

function sessionIdentity(session: Session | null) {
  if (!session) return null;
  try {
    const payload = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(payload));
    if (typeof claims.session_id === 'string' && claims.session_id) return claims.session_id;
  } catch {
    // Older sessions can still be identified without inspecting a refresh token.
  }
  return `${session.user.id}:${session.user.last_sign_in_at ?? 'legacy'}`;
}

type TimeoutState = {
  sessionId: string | null;
  expired: boolean;
  reason: SessionExpiryReason;
  warning: boolean;
  remainingSeconds: number;
};

export function useSessionTimeout(session: Session | null) {
  const sessionId = sessionIdentity(session);
  const userId = session?.user.id;
  const signedInAt = session?.user.last_sign_in_at;
  const [state, setState] = useState<TimeoutState>({
    sessionId: null, expired: false, reason: 'idle', warning: false, remainingSeconds: 0,
  });
  const handlers = useRef<{ continueSession?: () => void; endSession?: () => void }>({});
  const closingSession = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId || !userId) return;
    const key = `iconic:session:${userId}:${sessionId}`;
    const now = Date.now();
    const originalSignIn = Date.parse(signedInAt ?? '');
    const load = () => {
      try { return readSessionActivity(localStorage.getItem(key), sessionId); }
      catch { return null; }
    };
    let activity: SessionActivity = load() ?? {
      sessionId,
      startedAt: Number.isFinite(originalSignIn) ? Math.min(originalSignIn, now) : now,
      lastActivityAt: now,
    };
    let dirty = false;
    const persist = () => {
      try {
        const serialized = JSON.stringify(activity);
        if (localStorage.getItem(key) !== serialized) localStorage.setItem(key, serialized);
      }
      catch { /* The current tab still enforces its in-memory deadline. */ }
      dirty = false;
    };
    const merge = () => {
      const other = load();
      if (!other) return;
      activity = {
        sessionId,
        startedAt: Math.min(activity.startedAt, other.startedAt),
        lastActivityAt: Math.max(activity.lastActivityAt, other.lastActivityAt),
        expiredReason: activity.expiredReason ?? other.expiredReason,
      };
    };
    const expire = (reason: SessionExpiryReason) => {
      activity.expiredReason = reason;
      persist();
      setState(previous => previous.sessionId === sessionId && previous.expired && previous.reason === reason
        ? previous : { sessionId, expired: true, reason, warning: false, remainingSeconds: 0 });
      if (closingSession.current === sessionId) return;
      closingSession.current = sessionId;
      // Block the workspace even if logout cannot reach Auth while offline.
      void supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    };
    const check = () => {
      merge();
      const result = evaluateSession(activity, Date.now());
      if (result.expired) { expire(result.reason); return result; }
      if (dirty) persist();
      setState(previous => {
        const next = { sessionId, ...result };
        return previous.sessionId === sessionId && !previous.expired && previous.warning === result.warning &&
          previous.reason === result.reason && (!result.warning || previous.remainingSeconds === result.remainingSeconds)
          ? previous : next;
      });
      return result;
    };
    const registerActivity = (event: Event) => {
      if (!event.isTrusted) return;
      merge();
      const result = evaluateSession(activity, Date.now());
      // A late click after sleep must not revive an already expired session.
      if (result.expired) { expire(result.reason); return; }
      if (result.warning) return;
      activity.lastActivityAt = Date.now();
      dirty = true;
    };
    const resume = () => { check(); };
    handlers.current = {
      continueSession: () => {
        merge();
        const result = evaluateSession(activity, Date.now());
        if (result.expired) { expire(result.reason); return; }
        if (result.reason === 'absolute' && result.warning) return;
        activity.lastActivityAt = Date.now();
        persist();
        check();
      },
      endSession: () => expire(evaluateSession(activity, Date.now()).reason),
    };
    check();
    if (!activity.expiredReason) persist();
    const timer = window.setInterval(check, 1000);
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input'] as const;
    events.forEach(event => window.addEventListener(event, registerActivity, { passive: true, capture: true }));
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    function onStorage(event: StorageEvent) { if (event.key === key) check(); }
    return () => {
      window.clearInterval(timer);
      if (dirty) persist();
      events.forEach(event => window.removeEventListener(event, registerActivity, true));
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
      handlers.current = {};
    };
  }, [sessionId, userId, signedInAt]);

  const continueSession = useCallback(() => handlers.current.continueSession?.(), []);
  const endSession = useCallback(() => handlers.current.endSession?.(), []);
  const current = state.sessionId === sessionId;
  return {
    expired: current && state.expired,
    expirationReason: state.expired ? state.reason : null,
    warning: current && !state.expired && state.warning ? state : null,
    continueSession,
    endSession,
  };
}
