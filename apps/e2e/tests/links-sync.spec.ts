import { randomUUID } from 'node:crypto';

import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

const JIRA_PLACEHOLDER = 'https://jira.example.com/TASK-123';
const CONFLUENCE_PLACEHOLDER = 'https://confluence.example.com/page';

/**
 * Регрессионный набор: ссылки Jira/Confluence синхронизируются между участниками
 * в реальном времени, а сохранение по устаревшей версии не затирает молча чужую
 * правку — сервер отвечает конфликтом (см. README «Одновременные действия»).
 */
test('ссылки синхронизируются между участниками и защищены от гонки при одновременном сохранении', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  const owner = await createUser('owner-links');
  const ownerContext = await newContext(browser);
  await loginAs(ownerContext, owner);
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto('/');

  await ownerPage.getByRole('button', { name: 'Создать комнату', exact: true }).click();
  const roomName = `${E2E_ROOM_PREFIX}Links ${randomUUID().slice(0, 8)}`;
  await ownerPage.getByPlaceholder('Например, Планирование спринта').fill(roomName);
  await ownerPage.locator('form').getByRole('button', { name: 'Создать комнату' }).click();
  await ownerPage.waitForURL(/\/rooms\/[0-9a-f-]{36}/);
  const roomUrl = ownerPage.url();

  const guestContext = await newContext(browser);
  const guestPage = await guestContext.newPage();
  await guestPage.goto(roomUrl);
  await guestPage.getByPlaceholder('Например, Мария').fill('Гость Ссылки');
  await guestPage.getByRole('button', { name: 'Войти в комнату' }).click();
  await expect(ownerPage.getByText('Участники')).toBeVisible();

  // Владелец сохраняет ссылку на Jira — гость её не трогал, поэтому рассылка
  // должна обновить его форму сама, без перезагрузки страницы
  await ownerPage.getByPlaceholder(JIRA_PLACEHOLDER).fill('https://jira.example.com/OWNER-1');
  await ownerPage.getByRole('button', { name: 'Сохранить' }).click();
  await expect(guestPage.getByPlaceholder(JIRA_PLACEHOLDER)).toHaveValue(
    'https://jira.example.com/OWNER-1',
  );

  /**
   * Независимый наблюдатель — барьер для второй owner-правки ниже. Нельзя
   * использовать `ownerSaveButton.toBeEnabled()`: кнопка уже enabled до того,
   * как async-save успеет стартовать, поэтому guest-запрос иногда попадал на
   * сервер первым и честно не получал конфликт. Наблюдатель не имеет черновика,
   * следовательно его форма обновится только после коммита и WS-рассылки.
   */
  const observerContext = await newContext(browser);
  const observerPage = await observerContext.newPage();
  await observerPage.goto(roomUrl);
  await observerPage.getByPlaceholder('Например, Мария').fill('Наблюдатель ссылок');
  await observerPage.getByRole('button', { name: 'Войти в комнату' }).click();
  await expect(observerPage.getByPlaceholder(JIRA_PLACEHOLDER)).toHaveValue(
    'https://jira.example.com/OWNER-1',
  );

  // Гость начинает править Confluence-ссылку (черновик), но ещё не сохранил —
  // тем временем владелец успевает сохранить свою правку первым
  await guestPage
    .getByPlaceholder(CONFLUENCE_PLACEHOLDER)
    .fill('https://confluence.example.com/GUEST-DRAFT');
  await ownerPage.getByPlaceholder(JIRA_PLACEHOLDER).fill('https://jira.example.com/OWNER-2');
  const ownerSaveButton = ownerPage.getByRole('button', { name: 'Сохранить' });
  await ownerSaveButton.click();
  await expect(observerPage.getByPlaceholder(JIRA_PLACEHOLDER)).toHaveValue(
    'https://jira.example.com/OWNER-2',
  );

  // Черновик гостя основан на устаревшей версии — сохранение отклоняется конфликтом,
  // а не тихо перезаписывает то, что уже сохранил владелец
  await guestPage.getByRole('button', { name: 'Сохранить' }).click();
  // Текст тоста задублирован скрытым aria-live регионом для скринридеров — уточняем видимую зону.
  // Барьер через observer выше гарантирует, что stale-version уже есть на сервере;
  // увеличенный timeout оставляем только на транспорт + рендер самого тоста под нагрузкой.
  await expect(
    guestPage
      .getByRole('region', { name: /Notifications/ })
      .getByText('Не удалось сохранить ссылки. Попробуйте ещё раз.'),
  ).toBeVisible({ timeout: 15_000 });

  // Перезаходим гостем и проверяем: сохранилась версия владельца, черновик гостя не долетел
  await guestPage.reload();
  await guestPage.getByRole('button', { name: 'Войти в комнату' }).click();
  await expect(guestPage.getByPlaceholder(JIRA_PLACEHOLDER)).toHaveValue(
    'https://jira.example.com/OWNER-2',
  );
  await expect(guestPage.getByPlaceholder(CONFLUENCE_PLACEHOLDER)).toHaveValue('');
});
