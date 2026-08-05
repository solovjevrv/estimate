import sharp from 'sharp';

import { expect, test } from '../src/fixtures';

/**
 * Регрессионный сценарий: загрузка своей аватарки на странице «Профиль» (10.15).
 * Проверяет реальный кроппер (canvas) в браузере — не только сборку данных на фронте.
 */
test('загрузка аватарки: выбор файла, кроп по умолчанию, сохранение и переживание перезагрузки', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  const user = await createUser('avatar-upload');
  const context = await newContext(browser);
  await loginAs(context, user);
  const page = await context.newPage();
  await page.goto('/profile');

  // Email также попадает в подсказку/название кнопки меню пользователя в шапке — берём
  // именно параграф профиля, а не первое совпадение по всей странице
  await expect(page.getByRole('paragraph').filter({ hasText: user.email })).toBeVisible();

  const image = await sharp({
    create: { width: 300, height: 300, channels: 3, background: { r: 30, g: 120, b: 200 } },
  })
    .jpeg()
    .toBuffer();

  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: image });

  await expect(page.getByRole('heading', { name: 'Обрежьте фото' })).toBeVisible();

  // Кнопка сама сигнализирует готовность: Cropper строит внутренний canvas асинхронно
  // после загрузки картинки — клик раньше времени ничего не отправит (getResult().canvas пуст)
  const saveButton = page.getByRole('dialog').getByRole('button', { name: 'Сохранить' });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  // Тост дублируется скрытым aria-live-анонсером с тем же текстом (11.3) —
  // берём видимый заголовок, а не первое совпадение по всей странице
  await expect(page.getByText('Аватарка обновлена', { exact: true })).toBeVisible();
  const avatarImg = page.locator('img[alt="E2E avatar-upload"]').first();
  await expect(avatarImg).toBeVisible();
  const avatarSrc = await avatarImg.getAttribute('src');
  expect(avatarSrc).toContain('/api/avatars/');

  // Переживает перезагрузку — значит реально сохранилась на сервере, а не только в сторе
  await page.reload();
  // Email также попадает в подсказку/название кнопки меню пользователя в шапке — берём
  // именно параграф профиля, а не первое совпадение по всей странице
  await expect(page.getByRole('paragraph').filter({ hasText: user.email })).toBeVisible();
  await expect(page.locator('img[alt="E2E avatar-upload"]').first()).toHaveAttribute(
    'src',
    avatarSrc!,
  );
});
