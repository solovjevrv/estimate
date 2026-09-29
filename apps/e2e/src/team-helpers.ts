import { randomUUID } from 'node:crypto';

import { expect, type Page } from '@playwright/test';

import { E2E_ROOM_PREFIX } from './fixtures';

/**
 * Владелец создаёт команду со страницы «Команды» и достаёт ссылку-приглашение.
 * Приглашение — модалка из меню «Действия с командой» (с 20.3.4a), а не поле
 * на странице. На пустом списке кнопка «Новая команда» видна дважды (шапка и
 * пустое состояние) — берём первую.
 */
export async function createTeamWithInvite(page: Page): Promise<{ inviteUrl: string }> {
  await page.goto('/teams');
  await page.getByRole('button', { name: 'Новая команда' }).first().click();
  const teamName = `${E2E_ROOM_PREFIX}Team ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Например, Гарантии').fill(teamName);
  await page.locator('form').getByRole('button', { name: 'Создать', exact: true }).click();
  await page.waitForURL(/\/teams\/[0-9a-f-]{36}/);

  await page.getByRole('button', { name: 'Действия с командой' }).click();
  await page.getByRole('menuitem', { name: 'Пригласить' }).click();
  const inviteDialog = page.getByRole('dialog');
  const inviteUrl = await inviteDialog.locator('input[readonly]').inputValue();
  await page.keyboard.press('Escape');
  await expect(inviteDialog).toBeHidden();
  return { inviteUrl };
}

/**
 * Командная доска со страницы команды: вкладка «Доски» → «Создать доску».
 * Переключатель «Командная доска» в окне по умолчанию включён и указывает на
 * текущую команду (DS-063), поэтому достаточно ввести название. Возвращает URL доски.
 */
export async function createTeamBoard(page: Page, label: string): Promise<string> {
  await page.getByRole('button', { name: 'Доски', exact: true }).click();
  await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
  const boardName = `${E2E_ROOM_PREFIX}${label} ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
  await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
  await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
  return page.url();
}
