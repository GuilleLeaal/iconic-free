import { test, expect } from '@playwright/test';

const viewports = [
  { width: 320, height: 480 },
  { width: 320, height: 400 },
  { width: 320, height: 320 },
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 393, height: 851 },
  { width: 600, height: 600 },
  { width: 600, height: 801 },
  { width: 601, height: 601 },
  { width: 768, height: 601 },
  { width: 768, height: 1024 },
  { width: 1024, height: 600 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 568, height: 320 },
  { width: 667, height: 375 },
  { width: 844, height: 390 },
];

for (const viewport of viewports) {
  test(`acceso sin scroll a ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.route('http://127.0.0.1:54321/auth/v1/recover*', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
    }));
    await page.route('http://127.0.0.1:54321/auth/v1/token*', route => route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'invalid_credentials', message: 'Invalid login credentials' }),
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
    }));

    const checkLayout = async () => {
      await expect(page.getByLabel('Correo', { exact: true })).toBeInViewport({ ratio: 1 });
      await expect(page.getByLabel('Contraseña', { exact: true })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Recuperar acceso / solicitar enlace nuevo', exact: true })).toBeInViewport({ ratio: 1 });
      await expect(page.locator('.marca')).toBeInViewport({ ratio: 1 });
      const dimensions = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      }));
      expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewportWidth);
      expect(dimensions.height).toBeLessThanOrEqual(dimensions.viewportHeight);
    };

    await page.goto('/');
    await checkLayout();
    await page.getByRole('button', { name: 'Recuperar acceso / solicitar enlace nuevo', exact: true }).click();
    await expect(page.getByRole('alert')).toBeInViewport({ ratio: 1 });
    await checkLayout();

    await page.goto('/?error=access_denied');
    await expect(page.getByRole('alert')).toBeInViewport({ ratio: 1 });
    await checkLayout();

    await page.getByLabel('Correo', { exact: true }).fill('cuenta@prueba.local');
    await page.getByRole('button', { name: 'Recuperar acceso / solicitar enlace nuevo', exact: true }).click();
    await expect(page.getByRole('status')).toBeInViewport({ ratio: 1 });
    await checkLayout();
    await page.getByLabel('Contraseña', { exact: true }).fill('test-password');
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await expect(page.getByRole('alert')).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('status')).toBeInViewport({ ratio: 1 });
    await checkLayout();
    await page.screenshot({ path: testInfo.outputPath('acceso.png'), fullPage: true });
  });
}
