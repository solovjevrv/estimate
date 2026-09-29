import type { BoardItem } from '@estimate/shared';

/**
 * ФРЕЙМ (не группа!), в чьи границы попадает точка — фрейм задуман как
 * мини-холст (референс Miro): всё, что создаётся или перетаскивается внутрь
 * его границ, сразу становится его содержимым (`parentId`), а не лежит
 * поверх него отдельным несвязанным элементом. Группа сюда сознательно НЕ
 * попадает — она невидима, у неё нет заметных пользователю границ, чтобы
 * целиться, и в отличие от фрейма членство в ней меняется только явным
 * действием «Группировать»/«Разгруппировать», а не геометрией драга — иначе
 * элемент мог бы "случайно" прилипнуть к чьей-то невидимой старой группе
 * просто оказавшись над её bounding box (запутывающий баг, найденный вручную).
 * Если точка попадает сразу в несколько перекрывающихся фреймов — берём
 * наименьший по площади (обычно самый "внутренний" визуально). `excludeId` —
 * не рассматривать сам себя (при перетаскивании фрейма он не должен
 * попытаться стать своим же родителем).
 */
export function findFrameAt(
  items: readonly BoardItem[],
  point: { x: number; y: number },
  excludeId?: string,
): BoardItem | undefined {
  let best: BoardItem | undefined;
  let bestArea = Infinity;
  for (const candidate of items) {
    if (candidate.id === excludeId) continue;
    if (candidate.content.type !== 'frame') continue;
    if (
      point.x < candidate.x ||
      point.x > candidate.x + candidate.width ||
      point.y < candidate.y ||
      point.y > candidate.y + candidate.height
    ) {
      continue;
    }
    const area = candidate.width * candidate.height;
    if (area < bestArea) {
      best = candidate;
      bestArea = area;
    }
  }
  return best;
}
