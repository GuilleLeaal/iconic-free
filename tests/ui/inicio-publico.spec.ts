import { test, expect } from '@playwright/test';

const competencias = [
  ['DEM Battles', 'dem-battles'],
  ['9na Avenida', '9na-avenida'],
  ['Green & White', 'green-and-white'],
  ['AntagFreestyle', 'antag-freestyle'],
  ['Iconic Freestyle', 'iconic-freestyle'],
  ['Exiliados Park', 'exiliados-park'],
];

test('inicio público con identidades locales, orden editorial y páginas de presentación', async ({ page }, testInfo) => {
  const consultasPrivadas: string[] = [];
  const errores: string[] = [];
  page.on('pageerror', error => errores.push(error.message));
  await page.route('http://127.0.0.1:54321/**', route => {
    consultasPrivadas.push(route.request().url());
    return route.abort();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Competencias de freestyleen Uruguay.');
  await expect(page.getByRole('link', { name: 'Competencias de freestyle · Inicio' })).toBeVisible();
  await expect(page.getByLabel('Correo', { exact: true })).toHaveCount(0);
  const tarjetas = page.locator('.inicio-grilla > li');
  await expect(tarjetas).toHaveCount(6);
  for (const [i, [nombre, slug]] of competencias.entries()) {
    const tarjeta = tarjetas.nth(i);
    await expect(tarjeta.getByRole('heading')).toHaveText(nombre);
    await expect(tarjeta.getByRole('link')).toHaveAttribute('href', `/competencias/${slug}`);
    await expect(tarjeta.getByRole('link')).not.toHaveAttribute('target', '_blank');
    const logo = tarjeta.getByRole('img', { name: `Logo de ${nombre}`, exact: true });
    await logo.scrollIntoViewIfNeeded();
    await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await logo.getAttribute('src')).not.toMatch(/^https?:/);
  }
  expect(consultasPrivadas).toEqual([]);
  expect(errores).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('inicio-publico.png'), fullPage: true });
});

test('navegación pública, acceso directo y regreso al inicio', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Ver competencias', exact: true }).click();
  await expect(page).toHaveURL(/\/#competencias$/);
  await expect(page.getByRole('heading', { name: 'Competencias', exact: true })).toBeInViewport();
  await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('Correo', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Contraseña', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Inicio', exact: true }).click();
  await expect(page.locator('.inicio-grilla > li')).toHaveCount(6);
  await page.goBack();
  await expect(page.getByLabel('Correo', { exact: true })).toBeVisible();
});

test('el enlace vencido conserva su aviso y permite volver a la portada', async ({ page }) => {
  await page.goto('/#error=access_denied&error_code=otp_expired');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('alert')).toContainText('El enlace venció');
  await page.getByRole('link', { name: 'Inicio', exact: true }).click();
  await expect(page.locator('.inicio-grilla > li')).toHaveCount(6);
});
