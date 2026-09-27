import { expect, type Page } from '@playwright/test';

/**
 * Гость входит в открытую по ссылке комнату. Кнопку ищем внутри формы: «Войти»
 * есть и в шапке гостя (вход через провайдера).
 */
export async function joinAsGuest(page: Page, name: string): Promise<void> {
  await page.getByPlaceholder('Введите имя').fill(name);
  await page.locator('form').getByRole('button', { name: 'Войти', exact: true }).click();
}

/**
 * Сколько участников уже проголосовало в текущем раунде. Отдельного счётчика в
 * интерфейсе больше нет (07_Room, 20.3.6) — у каждой карточки участника есть
 * скрытый статус «Проголосовал»/«Ожидаем», считаем по нему.
 */
export async function expectVoted(page: Page, voted: number, total: number): Promise<void> {
  await expect(page.getByText('Проголосовал', { exact: true })).toHaveCount(voted);
  await expect(page.getByText('Ожидаем', { exact: true })).toHaveCount(total - voted);
}

/** Показатель панели результатов: кольцо StatRing — группа с подписью «Метка: значение» */
export function stat(page: Page, label: string, value: string | number) {
  return page.getByRole('group', { name: `${label}: ${value}`, exact: true });
}
