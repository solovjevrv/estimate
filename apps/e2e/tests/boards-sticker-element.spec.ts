import { randomUUID } from 'node:crypto';

import type { Locator } from '@playwright/test';

import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Стикер-паки на холсте (13.4, редизайн под референс Miro) — кнопка в левом
 * тулбаре открывает поповер: сверху строка табов (недавние + превью каждого
 * пака, клик скроллит список ниже), ниже — один скролл со всеми стикерами
 * сразу, каждый пак — секция со своим заголовком. Клик по стикеру сразу
 * вставляет элемент в центр вьюпорта (без промежуточного клика по холсту, как
 * у эмодзи/картинки); тулбар выделения — только замена стикера/дублировать/
 * удалить, пикер там тот же компонент (`BoardStickerPicker.vue`).
 * Аватарки стикеров (emoji-метка Telegram) внутри пака не гарантированно
 * уникальны, поэтому выбор конкретного стикера в тесте — по позиции внутри
 * секции пака, а не по aria-label.
 */
test.describe('Доски: стикер-паки', () => {
  test('вставка через тулбар, персистентность после reload, упрощённый тулбар выделения и замена', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-sticker');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}Sticker ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(page.locator('.vue-flow__pane')).toBeVisible();

    function stickerInPack(root: Locator, packLabel: string): Locator {
      return root
        .locator('.board-sticker-picker-section', { hasText: packLabel })
        .locator('.board-sticker-picker-item')
        .first();
    }

    // Клик по инструменту сразу открывает пикер — без клика по холсту
    await page.locator('.board-toolbar button[aria-label="Стикер-паки"]').click();
    await expect(page.locator('.board-sticker-picker')).toBeVisible();
    await stickerInPack(page, 'Жизнерадостная утя').click();

    const stickerNode = page.locator('.vue-flow__node-sticker').first();
    await expect(stickerNode).toBeVisible();
    const firstSrc = await stickerNode.locator('img').getAttribute('src');
    expect(firstSrc).toBeTruthy();

    // Переживает перезагрузку — сохранилось на сервере
    await page.reload();
    await expect(page.locator('.vue-flow__node-sticker')).toHaveCount(1);
    await expect(page.locator('.vue-flow__node-sticker').first().locator('img')).toHaveAttribute(
      'src',
      firstSrc!,
    );

    // Тулбар выделения — только замена стикера + дублировать + удалить
    await page.locator('.vue-flow__node-sticker').click();
    const toolbar = page.locator('.board-selection-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByLabel('Заменить стикер')).toBeVisible();
    await expect(toolbar.getByLabel('Тип элемента')).toHaveCount(0);
    await expect(toolbar.getByLabel('Цвет')).toHaveCount(0);
    await expect(toolbar.getByLabel('Настройки текста')).toHaveCount(0);
    await expect(toolbar.getByLabel('Выравнивание')).toHaveCount(0);
    await expect(toolbar.getByLabel('Начертание')).toHaveCount(0);
    await expect(toolbar.getByLabel('Маркер')).toHaveCount(0);
    await expect(toolbar.getByLabel('Ссылка')).toHaveCount(0);
    await expect(toolbar.getByLabel('Дублировать')).toBeVisible();
    await expect(toolbar.getByLabel('Удалить')).toBeVisible();

    // Замена стикера через тулбар выделения — другой пак (через таб сверху), другая картинка
    await toolbar.getByLabel('Заменить стикер').click();
    const replacePopover = page.locator('.board-sticker-picker').last();
    await replacePopover.getByRole('button', { name: 'Вечная классика' }).click();
    await stickerInPack(replacePopover, 'Вечная классика').click();

    await expect(page.locator('.vue-flow__node-sticker')).toHaveCount(1);
    const secondSrc = await page
      .locator('.vue-flow__node-sticker')
      .first()
      .locator('img')
      .getAttribute('src');
    expect(secondSrc).toBeTruthy();
    expect(secondSrc).not.toBe(firstSrc);

    // Раздел «Недавние» появляется после того, как хотя бы один стикер был выбран
    await page.locator('.vue-flow__node-sticker').click();
    await toolbar.getByLabel('Заменить стикер').click();
    await expect(
      page.locator('.board-sticker-picker').last().locator('.board-sticker-picker-section', {
        hasText: 'Недавние',
      }),
    ).toBeVisible();
  });
});
