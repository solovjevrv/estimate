import { randomUUID } from 'node:crypto';

import { schema } from '@estimate/server/db';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Перф-тест анимированных Lottie-стикеров (21.10, по мотивам замера в 21.7/21.8 —
 * см. docs/sticker-animation-perf-report.md). НЕ часть автоматического CI (ни PR-смоук,
 * ни ночной регресс — тег @perf исключён и там, и там в apps/e2e/package.json): требует
 * реального TELEGRAM_BOT_TOKEN в .env и гоняется вручную при внедрении фич, способных
 * повлиять на клиентский рендер стикеров (смена renderer/lottie-web/StickerMedia.vue и т.п.):
 *
 *   pnpm --filter @estimate/e2e test:perf
 *
 * Импортирует один реальный анимированный Telegram-пак и размножает один и тот же
 * стикер на 100 позиций доски напрямую в БД (не 100 живых скачиваний из Telegram — здесь
 * измеряется стоимость рендера на клиенте, а не импорта, тот же приём, что и в
 * первоначальном спайке 21.7). Снимает CPU/FPS/память через Chrome DevTools Protocol.
 *
 * Жёсткие ассерты — только грубые регрессии (число canvas-узлов, полное залипание
 * кадров): точные цифры машинно-зависимы, окончательное суждение о регрессии —
 * за человеком, сравнивающим залогированные числа с historical-числами из отчёта.
 */
const TELEGRAM_PACK = 'HotCherry';
const STICKER_COUNT = 100;
const MEASURE_WINDOW_MS = 5000;
const SERVER_ORIGIN = 'http://localhost:3000';

function metric(list: Array<{ name: string; value: number }>, name: string): number {
  return list.find((m) => m.name === name)?.value ?? 0;
}

test('@perf 100 анимированных Lottie-стикеров: CPU/FPS/память не деградируют катастрофически', async ({
  browser,
  createUser,
  loginAs,
  newContext,
  db,
}) => {
  test.slow();
  const owner = await createUser('perf-100-lottie');
  const context = await newContext(browser);
  await loginAs(context, owner);
  const page = await context.newPage();

  const importRes = await context.request.post(
    `${SERVER_ORIGIN}/api/sticker-packs/personal/import`,
    { data: { telegramSetName: TELEGRAM_PACK } },
  );
  expect(importRes.ok(), await importRes.text()).toBeTruthy();
  const { pack } = (await importRes.json()) as {
    pack: { id: string; stickers: Array<{ id: string; format: string }> };
  };
  const animated = pack.stickers.find((s) => s.format === 'animated');
  expect(animated, 'нужен хотя бы один анимированный стикер в паке').toBeTruthy();

  const boardTitle = `${E2E_ROOM_PREFIX}Perf100 ${randomUUID().slice(0, 8)}`;
  const [board] = await db
    .insert(schema.boards)
    .values({ ownerId: owner.id, title: boardTitle })
    .returning();

  const cols = 10;
  const spacing = 160;
  await db.insert(schema.boardItems).values(
    Array.from({ length: STICKER_COUNT }, (_, i) => ({
      boardId: board!.id,
      x: (i % cols) * spacing,
      y: Math.floor(i / cols) * spacing,
      width: 120,
      height: 120,
      content: {
        type: 'sticker' as const,
        pack: pack.id,
        id: animated!.id,
        format: 'animated' as const,
      },
      style: { color: '#fef08a' },
    })),
  );

  await page.goto(`/boards/${board!.id}`);
  const boardEl = boardLocators(page);
  await expect(boardEl.pane).toBeVisible();
  await expect(boardEl.stickerNodes).toHaveCount(STICKER_COUNT, { timeout: 30000 });
  // renderer: 'canvas' (21.8) — каждый узел должен быть <canvas>, не <svg>
  await expect(boardEl.stickerNodes.first().locator('canvas')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(4000); // дать всем Lottie-инстансам раскрутиться

  const client = await context.newCDPSession(page);
  await client.send('Performance.enable');
  const before = (await client.send('Performance.getMetrics')) as {
    metrics: Array<{ name: string; value: number }>;
  };

  const fpsResult = await page.evaluate(
    (ms) =>
      new Promise<{ fps: number; frames: number }>((resolve) => {
        const start = performance.now();
        let frames = 0;
        function tick(now: number) {
          frames++;
          if (now - start < ms) {
            requestAnimationFrame(tick);
          } else {
            resolve({ fps: (frames / (now - start)) * 1000, frames });
          }
        }
        requestAnimationFrame(tick);
      }),
    MEASURE_WINDOW_MS,
  );

  const after = (await client.send('Performance.getMetrics')) as {
    metrics: Array<{ name: string; value: number }>;
  };
  const windowSec = MEASURE_WINDOW_MS / 1000;
  const cpuPercent =
    ((metric(after.metrics, 'TaskDuration') - metric(before.metrics, 'TaskDuration')) / windowSec) *
    100;
  const jsHeapUsedMB = metric(after.metrics, 'JSHeapUsedSize') / 1048576;
  const nodes = metric(after.metrics, 'Nodes');

  console.log(
    `[perf 21.10] 100 анимированных стикеров: fps=${fpsResult.fps.toFixed(1)} ` +
      `cpu=${cpuPercent.toFixed(1)}% heap=${jsHeapUsedMB.toFixed(1)}МБ nodes=${nodes} ` +
      `(для сравнения с historical-числами — см. docs/sticker-animation-perf-report.md)`,
  );

  // Грубый регрессионный порог — не строгий SLA. Ниже этого доска уже нерабочая
  // (залипшие кадры/зависание вкладки), а не просто "чуть медленнее, чем раньше".
  expect(fpsResult.frames, 'ни одного кадра не отрисовано — вкладка зависла').toBeGreaterThan(0);
  expect(fpsResult.fps).toBeGreaterThan(15);
});
