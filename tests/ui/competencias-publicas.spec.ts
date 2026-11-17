import { test, expect } from '@playwright/test';

const competencias = [
  { slug: 'dem-battles', nombre: 'DEM Battles', cuenta: 'dem.uruguay', imagen: true },
  { slug: '9na-avenida', nombre: '9na Avenida', cuenta: '9na_avenida', imagen: true },
  { slug: 'green-and-white', nombre: 'Green & White', cuenta: 'greenandwhite_free', imagen: true },
  { slug: 'antag-freestyle', nombre: 'AntagFreestyle', cuenta: 'antagfree', imagen: true },
  { slug: 'iconic-freestyle', nombre: 'Iconic Freestyle', cuenta: 'iconic.free', imagen: false },
  { slug: 'exiliados-park', nombre: 'Exiliados Park', cuenta: 'exiliadospark', imagen: false },
];

for (const competencia of competencias) {
  test(`presentación pública de ${competencia.nombre}: acceso, identidad y contenido general`, async ({ page }, testInfo) => {
    const consultasPrivadas: string[] = [];
    const errores: string[] = [];
    page.on('pageerror', error => errores.push(error.message));
    await page.route('http://127.0.0.1:54321/**', route => {
      consultasPrivadas.push(route.request().url());
      return route.abort();
    });
    await page.goto('/');
    await page.getByRole('link', { name: `Conocer ${competencia.nombre}`, exact: true }).click();
    await expect(page).toHaveURL(`/competencias/${competencia.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(competencia.nombre);
    await expect(page).toHaveTitle(`${competencia.nombre} · Freestyle Uruguay`);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.+/);
    await expect(page.getByRole('link', { name: 'Ver Instagram', exact: true })).toHaveAttribute('href', `https://www.instagram.com/${competencia.cuenta}/`);
    await expect(page.getByRole('heading', { name: 'Canales oficiales', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Otras competencias', exact: true }).getByRole('link')).toHaveCount(5);
    await expect(page.locator('.competencia-acerca-texto > p').first()).toBeVisible();
    await expect(page.locator('.competencia-foto')).toHaveCount(competencia.imagen ? 1 : 0);
    const externos = await page.locator('main a[target="_blank"]').all();
    for (const enlace of externos) await expect(enlace).toHaveAttribute('rel', 'noopener noreferrer');
    for (const imagen of await page.locator('main img').all()) {
      await imagen.scrollIntoViewIfNeeded();
      await expect.poll(() => imagen.evaluate((elemento: HTMLImageElement) => elemento.complete && elemento.naturalWidth > 0)).toBe(true);
      expect(await imagen.getAttribute('src')).not.toMatch(/^https?:/);
    }
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(/próxim[ao]s? fechas?|inscripciones abiertas|\$\d|\d{1,2}:\d{2}/i);
    expect(consultasPrivadas).toEqual([]);
    expect(errores).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${competencia.slug}.png`), fullPage: true });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(competencia.nombre);
    await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
    await expect(page.getByLabel('Correo', { exact: true })).toBeVisible();
    await expect(page).toHaveTitle('Competencias · Freestyle Uruguay');
  });
}

test('se puede recorrer otras competencias, volver al listado y recuperar el título', async ({ page }) => {
  await page.goto('/competencias/dem-battles');
  await page.getByRole('navigation', { name: 'Otras competencias' }).getByRole('link', { name: '9na Avenida', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('9na Avenida');
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page).toHaveTitle('9na Avenida · Freestyle Uruguay');
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('DEM Battles');
  await expect(page).toHaveTitle('DEM Battles · Freestyle Uruguay');
  await page.getByRole('navigation', { name: 'Ubicación en el sitio' }).getByRole('link', { name: 'Competencias', exact: true }).click();
  await expect(page).toHaveURL('/#competencias');
  await expect(page.getByRole('heading', { name: 'Competencias', exact: true })).toBeInViewport();
  await expect(page).toHaveTitle('Competencias · Freestyle Uruguay');
});

test('una página inexistente muestra una salida al inicio', async ({ page }) => {
  await page.goto('/competencias/no-existe');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No encontramos esta página');
  await page.getByRole('link', { name: 'Ver competencias', exact: true }).click();
  await expect(page.locator('.inicio-grilla > li')).toHaveCount(6);
});

test('las seis presentaciones se ajustan al ancho de 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  for (const competencia of competencias) {
    await page.goto(`/competencias/${competencia.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(competencia.nombre);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
