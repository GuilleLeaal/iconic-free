import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const userId = '30000000-0000-4000-8000-000000000001';
const firstCompetition = '30000000-0000-4000-8000-000000000002';
const secondCompetition = '30000000-0000-4000-8000-000000000003';
const minute = 60 * 1000;
const baseTime = new Date('2026-11-04T12:00:00Z');

async function prepare(page: Page, offlineLogout = false) {
  let sessionNumber = 0;
  let signedInAt = baseTime.toISOString();
  let contextRequests = 0;
  const logoutScopes: (string | null)[] = [];
  const attach = async (target: Page) => {
    await target.route('http://127.0.0.1:54321/**', async route => {
      const request = route.request(), url = new URL(request.url());
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      const json = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers });
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const user = () => ({ id: userId, email: 'jurado@prueba.local', role: 'authenticated', aud: 'authenticated', created_at: '2026-01-01', last_sign_in_at: signedInAt, app_metadata: {}, user_metadata: {} });
      if (url.pathname.endsWith('/auth/v1/token')) {
        const now = await target.evaluate(() => Date.now());
        if (url.searchParams.get('grant_type') === 'password') { sessionNumber++; signedInAt = new Date(now).toISOString(); }
        const claims = { sub: userId, session_id: `session-${sessionNumber}`, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600, role: 'authenticated' };
        const token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test`;
        return json({ user: user(), access_token: token, refresh_token: `refresh-${sessionNumber}`, expires_in: 3600, token_type: 'bearer' });
      }
      if (url.pathname.endsWith('/auth/v1/user')) return json(user());
      if (url.pathname.endsWith('/auth/v1/logout')) {
        logoutScopes.push(url.searchParams.get('scope'));
        return offlineLogout ? route.abort('failed') : route.fulfill({ status: 204, headers });
      }
      if (url.pathname.endsWith('/perfiles')) return json({ id: userId, nombre: 'Jurado de prueba', nombre_usuario: 'jurado' });
      if (url.pathname.endsWith('/rpc/mis_contextos')) {
        contextRequests++;
        return json({ administrador: false, competencias: [
          { id: firstCompetition, nombre: 'Iconic', organizacion: false, jurado: true },
          { id: secondCompetition, nombre: 'Otra competencia', organizacion: false, jurado: true },
        ] });
      }
      if (url.pathname.endsWith('/rpc/mis_invitaciones')) return json([]);
      if (url.pathname.endsWith('/grupos_clasificatorias')) {
        const competition = url.searchParams.get('clasificatoria.fecha.competencia_id')?.slice(3) ?? firstCompetition;
        return json([{ id: `grupo-${competition}`, nombre: 'A', clasificatoria: { id: `clasi-${competition}`, estado: 'en_curso', casillas: ['Técnica'], fecha: { id: `fecha-${competition}`, nombre: 'Fecha de prueba', estado: 'en_curso', integrantes_por_equipo: 1, maximo_tanda: 2 } } }]);
      }
      if (url.pathname.endsWith('/rpc/consultar_tandas_jurado')) {
        const body = request.postDataJSON();
        const competition = body.p_grupo_id.replace('grupo-', '');
        return json({ tandas: [{ id: `tanda-${competition}`, grupo_id: body.p_grupo_id, numero: 1, entradas: [{ id: `mc-${competition}`, nombre: 'MC de prueba', integrantes: ['MC'], version: 1 }], retirados: [], estado: 'en_curso', participantes_bloqueados: false, version: 1 }], votos: [] });
      }
      throw new Error(`Solicitud sin fixture: ${request.method()} ${url.pathname}`);
    });
  };
  await page.clock.install({ time: baseTime });
  await attach(page);
  await page.goto('/');
  const login = async () => {
    await page.getByLabel('Correo', { exact: true }).fill('jurado@prueba.local');
    await page.getByLabel('Contraseña', { exact: true }).fill('test-password');
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await expect(page.getByRole('spinbutton').first()).toBeVisible();
  };
  await login();
  return { login, attach, logoutScopes, contextRequests: () => contextRequests };
}

test('avisa a los 58 minutos, permite continuar y expira sin contar consultas automáticas', async ({ page }) => {
  const fixture = await prepare(page);
  await page.clock.fastForward(58 * minute + 1000);
  await expect(page.getByRole('dialog', { name: 'Tu sesión está por vencer' })).toBeVisible();
  expect(fixture.contextRequests()).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Continuar sesión', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.clock.fastForward(57 * minute);
  await expect(page.getByRole('spinbutton').first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.clock.fastForward(3 * minute + 1000);
  await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('inactividad');
  await expect.poll(() => fixture.logoutScopes).toContain('local');
});

test('la interacción real reinicia la espera, pero los eventos programáticos no', async ({ page }) => {
  await prepare(page);
  await page.clock.fastForward(50 * minute);
  await page.getByRole('spinbutton').first().press('ArrowUp');
  await page.clock.fastForward(50 * minute);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })));
  await page.clock.fastForward(10 * minute + 1000);
  await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeVisible();
});

test('recargar no reinicia el plazo y el ingreso nuevo recupera competencia y borrador', async ({ page }) => {
  const fixture = await prepare(page);
  await page.getByRole('combobox', { name: 'Competencia activa', exact: true }).selectOption(secondCompetition);
  await expect(page.locator('.identidad-competencia h2')).toHaveText('Otra competencia');
  await page.getByRole('spinbutton').first().fill('7');
  await page.clock.fastForward(50 * minute);
  await page.reload();
  await expect(page.getByRole('spinbutton').first()).toHaveValue('7');
  await page.clock.fastForward(10 * minute + 1000);
  await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeVisible();
  await fixture.login();
  await expect(page.getByRole('combobox', { name: 'Competencia activa', exact: true })).toHaveValue(secondCompetition);
  await expect(page.getByRole('spinbutton').first()).toHaveValue('7');
});

test('el vencimiento bloquea la interfaz y persiste aunque falle el cierre por falta de red', async ({ page }) => {
  await prepare(page, true);
  await page.getByRole('spinbutton').first().fill('0');
  await page.clock.fastForward(60 * minute + 1000);
  await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  const draft = await page.evaluate(key => localStorage.getItem(key), `iconic:voto-clasi:${userId}:tanda-${firstCompetition}`);
  expect(draft).toContain('0');
});

test('continuar en una pestaña actualiza las otras y el vencimiento las cierra', async ({ page, context }) => {
  const fixture = await prepare(page);
  const other = await context.newPage();
  await fixture.attach(other);
  await other.goto('/');
  await expect(other.getByRole('spinbutton').first()).toBeVisible();
  await page.clock.fastForward(58 * minute + 1000);
  await expect(other.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar sesión', exact: true }).click();
  await expect(other.getByRole('dialog')).toHaveCount(0);
  await page.clock.fastForward(60 * minute + 1000);
  await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeVisible();
  await expect(other.getByRole('button', { name: 'Ingresar', exact: true })).toBeVisible();
});

test('las renovaciones y la actividad no extienden la duración máxima de doce horas', async ({ page }) => {
  test.setTimeout(60000);
  await prepare(page);
  for (let i = 0; i < 14; i++) {
    await page.clock.fastForward(50 * minute);
    await page.getByRole('spinbutton').first().press('ArrowUp');
  }
  await page.clock.fastForward(18 * minute + 1000);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar sesión', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Volver a ingresar', exact: true })).toBeVisible();
  await page.clock.fastForward(2 * minute);
  await expect(page.getByRole('alert')).toContainText('12 horas');
  await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeVisible();
});
