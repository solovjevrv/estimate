import type { BoardOp, EmojiSequence, GiphyGifSummary, PersonalStickerFormat } from '@poker/shared';

import type { BoardSelectionNode } from '../adapters/vue-flow-adapter';
import { FRAME_SIZE_PRESETS, type FrameSizePresetKey } from '../config/board-constants';
import { uuid } from '../infrastructure/uuid';

/**
 * Чистые билдеры `item.patch`-опов для «замены содержимого» выделения
 * (эмодзи/стикер/GIF/шаблон размера фрейма) — вынесены из
 * `use-board-selection.ts` (лимит `max-lines`, композабл и без того
 * разросся) отдельным модулем без доступа к `applyOps`/остальному
 * состоянию: их удобно тестировать напрямую, без моков composable.
 * Общий паттерн: пропустить неподходящий по `content.type` узел, а не
 * патчить его в чужую форму — единственное исключение ниже —
 * `frameSizePresetOps` (патчит `width`/`height`, не `content`, но
 * фильтрация та же самая, чтобы не испортить геометрию посторонних типов
 * в смешанном выделении).
 */

/** Смена эмодзи (13.3) — патчим content.emoji, не-эмодзи в выделении пропускаются */
export function emojiSwapOps(
  emoji: EmojiSequence,
  selectedNodes: readonly BoardSelectionNode[],
): BoardOp[] {
  return selectedNodes
    .filter((node) => node.data.content.type === 'emoji')
    .map((node) => ({
      type: 'item.patch',
      clientOpId: uuid(),
      id: node.id,
      patch: { content: { type: 'emoji', emoji } },
    }));
}

/** Смена стикера (13.4) — патчим content.pack/id, не-стикеры пропускаются */
export function stickerSwapOps(
  pack: string,
  id: string,
  format: PersonalStickerFormat | undefined,
  selectedNodes: readonly BoardSelectionNode[],
): BoardOp[] {
  const content = format
    ? { type: 'sticker' as const, pack, id, format }
    : { type: 'sticker' as const, pack, id };
  return selectedNodes
    .filter((node) => node.data.content.type === 'sticker')
    .map((node) => ({ type: 'item.patch', clientOpId: uuid(), id: node.id, patch: { content } }));
}

/**
 * Смена GIF (21.9) — патчим content.id/width/height (метаданные aspect ratio
 * нового GIF), геометрию самого элемента (бокс) не трогаем — рендер
 * (`StickerMedia`-подобный object-contain) сам вписывает новый GIF в
 * существующий бокс, как и при замене картинки.
 */
export function giphySwapOps(
  gif: GiphyGifSummary,
  selectedNodes: readonly BoardSelectionNode[],
): BoardOp[] {
  return selectedNodes
    .filter((node) => node.data.content.type === 'giphy')
    .map((node) => ({
      type: 'item.patch',
      clientOpId: uuid(),
      id: node.id,
      patch: { content: { type: 'giphy', id: gif.id, width: gif.width, height: gif.height } },
    }));
}

/**
 * Шаблон размера фрейма (22.4.2, по референсу Miro) — патчит только
 * `width`/`height`, `x`/`y` (верхний левый угол) не трогаем: рост/сжатие идёт
 * от угла, как и обычный ручной ресайз. Пустой массив для `custom` (которого
 * нет в `FRAME_SIZE_PRESETS`, см. board-constants.ts) — это «свободная
 * форма», клик по ней в тулбаре не меняет геометрию.
 */
export function frameSizePresetOps(
  preset: FrameSizePresetKey,
  selectedNodes: readonly BoardSelectionNode[],
): BoardOp[] {
  const dimensions = FRAME_SIZE_PRESETS.find((item) => item.key === preset);
  if (!dimensions) return [];
  const { width, height } = dimensions;
  return selectedNodes
    .filter((node) => node.data.content.type === 'frame')
    .map((node) => ({
      type: 'item.patch',
      clientOpId: uuid(),
      id: node.id,
      patch: { width, height },
    }));
}
