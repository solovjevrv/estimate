import { randomUUID } from 'node:crypto';

import sharp from 'sharp';

import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Картинка на холсте (13.2) — создание через левый тулбар (тот же `createImage()`,
 * что вызывают обработчики drag&drop/paste — путь загрузки один и тот же),
 * реальная загрузка на сервер, проверка персистентности после reload.
 */
test.describe('Доски: картинка', () => {
  test('загрузка картинки через тулбар, реальный upload и персистентность после reload', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-image');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}Image ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(page.locator('.vue-flow__pane')).toBeVisible();

    const image = await sharp({
      create: { width: 600, height: 400, channels: 3, background: { r: 40, g: 160, b: 90 } },
    })
      .jpeg()
      .toBuffer();

    // Инструмент «Картинка» открывает нативный файловый диалог — перехватываем
    // его через filechooser, как в avatar-upload.spec.ts
    await page.locator('.board-toolbar button[aria-label="Картинка"]').click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('.vue-flow__pane').click({ position: { x: 400, y: 300 } });
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: image });

    // Пока идёт загрузка — тост, затем на холсте появляется элемент-картинка
    await expect(page.locator('.vue-flow__node-image')).toHaveCount(1, { timeout: 15_000 });
    const img = page.locator('.vue-flow__node-image img');
    await expect(img).toBeVisible();
    const src = await img.getAttribute('src');
    expect(src).toMatch(/^\/api\/boards\/[0-9a-f-]{36}\/assets\/[a-f0-9]{32}\.webp$/);

    // Картинка реально отдаётся (не битая ссылка) — не только присутствует в DOM
    const served = await page.request.get(src!);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('image/webp');

    // Переживает перезагрузку — значит реально сохранилась на сервере, а не только в сторе
    await page.reload();
    await expect(page.locator('.vue-flow__node-image')).toHaveCount(1);
    await expect(page.locator('.vue-flow__node-image img')).toHaveAttribute('src', src!);
  });
});
