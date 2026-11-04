import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSession, readSessionActivity, SESSION_IDLE_MS, SESSION_MAX_MS, SESSION_WARNING_MS } from '../src/lib/sessionPolicy.ts';

const start = Date.parse('2026-11-04T12:00:00Z');
const activity = { sessionId: 'session-1', startedAt: start, lastActivityAt: start };

test('la advertencia empieza dos minutos antes y el plazo vence exactamente a la hora', () => {
  assert.equal(evaluateSession(activity, start + SESSION_IDLE_MS - SESSION_WARNING_MS - 1).warning, false);
  assert.equal(evaluateSession(activity, start + SESSION_IDLE_MS - SESSION_WARNING_MS).warning, true);
  assert.equal(evaluateSession(activity, start + SESSION_IDLE_MS - 1).expired, false);
  assert.equal(evaluateSession(activity, start + SESSION_IDLE_MS).expired, true);
});

test('la actividad reciente no extiende las doce horas desde el ingreso', () => {
  const recent = { ...activity, lastActivityAt: start + SESSION_MAX_MS - 1000 };
  assert.equal(evaluateSession(recent, start + SESSION_MAX_MS).reason, 'absolute');
  assert.equal(evaluateSession(recent, start + SESSION_MAX_MS).expired, true);
});

test('una sesión marcada como vencida no revive con otro evento ni un reloj atrasado', () => {
  assert.equal(evaluateSession({ ...activity, expiredReason: 'idle', lastActivityAt: start + 100 }, start).expired, true);
});

test('la lectura rechaza datos dañados y registros de otra sesión', () => {
  assert.equal(readSessionActivity('{', 'session-1'), null);
  assert.equal(readSessionActivity(JSON.stringify(activity), 'session-2'), null);
  assert.equal(readSessionActivity(JSON.stringify({ ...activity, lastActivityAt: start - 1 }), 'session-1'), null);
  assert.deepEqual(readSessionActivity(JSON.stringify(activity), 'session-1'), activity);
});
