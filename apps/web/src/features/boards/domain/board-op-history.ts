/**
 * Инверсия и фильтрация операций доски для undo/redo (12.10). Стек — не
 * снимков (снимок в реалтайме затёр бы чужую параллельную правку), а
 * инверсных операций: каждая запись истории хранит и то, что было сделано
 * (`forward`, для redo), и то, что это отменяет (`backward`, для undo).
 *
 * `deriveInverseOps` читает `local` — то же состояние, что `applyLocalBoardOp`
 * в `stores/board-session.ts` мутирует ПОСЛЕ вызова этой функции: инверсию
 * обязательно считать ДО применения `ops`, иначе "старые" значения полей уже
 * будут перезаписаны новыми.
 */
import type {
  BoardEdge,
  BoardEdgePatchOp,
  BoardEdgeStyle,
  BoardItem,
  BoardItemPatchOp,
  BoardItemStyle,
  BoardOp,
} from '@estimate/shared';

import type { BoardLocalState } from './apply-local-op';
import { uuid } from '../infrastructure/uuid';

export interface BoardHistoryEntry {
  forward: BoardOp[];
  backward: BoardOp[];
}

export { BOARD_HISTORY_LIMIT } from '../config/board-constants';

function pickKeys<T extends object, K extends keyof T>(source: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) result[key] = source[key];
  return result;
}

/**
 * Инверс-патч только по полям, которые реально тронул `patch` (не вся
 * запись целиком) — иначе более свежая чужая правка НЕтронутых полей,
 * долетевшая уже после этой операции, откатилась бы назад вместе с undo.
 * `style` — вложенный партиал (12.9), пикается отдельно теми же ключами.
 */
function invertItemPatch(
  existing: BoardItem,
  patch: BoardItemPatchOp['patch'],
): BoardItemPatchOp['patch'] {
  const inverse: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if (key === 'style') {
      if (patch.style) {
        inverse.style = pickKeys(
          existing.style,
          Object.keys(patch.style) as (keyof BoardItemStyle)[],
        );
      }
    } else {
      inverse[key] = (existing as unknown as Record<string, unknown>)[key];
    }
  }
  return inverse;
}

function invertEdgePatch(
  existing: BoardEdge,
  patch: BoardEdgePatchOp['patch'],
): BoardEdgePatchOp['patch'] {
  const inverse: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if (key === 'style') {
      if (patch.style) {
        inverse.style = pickKeys(
          existing.style,
          Object.keys(patch.style) as (keyof BoardEdgeStyle)[],
        );
      }
    } else {
      inverse[key] = (existing as unknown as Record<string, unknown>)[key];
    }
  }
  return inverse;
}

/**
 * `item.delete` восстанавливает не только сам элемент, но и связи, которые
 * сервер каскадно удалил вместе с ним (board-ops.ts) — иначе undo удаления
 * карточки со стрелкой вернул бы карточку без стрелки. `capturedEdgeIds` не
 * даёт продублировать связь, если её как-то восстанавливает больше одной
 * операции в батче (оба конца удалены одним батчем — cascade сработал бы
 * дважды; либо конец и сама связь удалены явно одним батчем).
 *
 * Все `edge.create` собираются в ОТДЕЛЬНЫЙ массив и приписываются в конец —
 * не в порядке появления операций. Батч `[item.delete(i1), item.delete(i2)]`
 * при связанных i1↔i2 иначе дал бы `[item.create(i1), edge.create(e1),
 * item.create(i2)]`: сервер применяет батч строго по порядку (`board-ops.ts`,
 * `boards.service.ts`) и на `edge.create(e1)` со ссылкой на ещё не созданный
 * i2 отклонил бы ВЕСЬ батч целиком, включая уже "восстановленный" оптимистично
 * на клиенте i1 — необнаруживаемое расхождение клиент/сервер до перезагрузки.
 */
export function deriveInverseOps(ops: BoardOp[], local: BoardLocalState): BoardOp[] {
  const inverses: BoardOp[] = [];
  const edgeCreateInverses: BoardOp[] = [];
  const capturedEdgeIds = new Set<string>();

  const scheduleEdgeCreate = (edge: BoardEdge): void => {
    if (capturedEdgeIds.has(edge.id)) return;
    capturedEdgeIds.add(edge.id);
    edgeCreateInverses.push({ type: 'edge.create', clientOpId: uuid(), edge });
  };

  for (const op of ops) {
    switch (op.type) {
      case 'item.create':
        inverses.push({ type: 'item.delete', clientOpId: uuid(), id: op.item.id });
        break;

      case 'item.delete': {
        const existing = local.items.get(op.id);
        if (existing) {
          inverses.push({ type: 'item.create', clientOpId: uuid(), item: existing });
        }
        for (const edge of local.edges.values()) {
          if (edge.sourceItemId === op.id || edge.targetItemId === op.id) {
            scheduleEdgeCreate(edge);
          }
        }
        // Удаление контейнера (frame/group, 14.3) осирают детей (parentId → null,
        // board-ops.ts + apply-local-op.ts): в inverse восстанавливаем их связь
        // `parentId → <id удаляемого контейнера>`. Т.к. `item.create` этого
        // контейнера уже запланирован выше, а сервер применяет батч по порядку,
        // дети ссыются на уже созданный к этому моменту родитель — порядок
        // сохраняется автоматически.
        for (const child of local.items.values()) {
          if (child.parentId === op.id) {
            inverses.push({
              type: 'item.patch',
              clientOpId: uuid(),
              id: child.id,
              patch: { parentId: op.id },
            });
          }
        }
        break;
      }

      case 'item.patch': {
        const existing = local.items.get(op.id);
        if (!existing) break;
        inverses.push({
          type: 'item.patch',
          clientOpId: uuid(),
          id: op.id,
          patch: invertItemPatch(existing, op.patch),
        });
        break;
      }

      // Реакции — не отслеживаемое undo-действие (как в мессенджерах, повторный
      // клик уже сам по себе toggle обратно); applyOps всегда шлёт их с
      // record:false, так что сюда этот case реально не попадает
      case 'item.react':
        break;

      case 'edge.create':
        inverses.push({ type: 'edge.delete', clientOpId: uuid(), id: op.edge.id });
        break;

      case 'edge.delete': {
        const existing = local.edges.get(op.id);
        if (existing) scheduleEdgeCreate(existing);
        break;
      }

      case 'edge.patch': {
        const existing = local.edges.get(op.id);
        if (!existing) break;
        inverses.push({
          type: 'edge.patch',
          clientOpId: uuid(),
          id: op.id,
          patch: invertEdgePatch(existing, op.patch),
        });
        break;
      }
    }
  }

  return reorderContainerCreatesFirst([...inverses, ...edgeCreateInverses]);
}

/**
 * Гарантирует, что `item.create` контейнера (frame/group, 14.3) в массиве
 * всегда стоит РАНЬШЕ `item.create` его ребёнка, независимо от исходного
 * порядка `ops`/итерации `local.items` (Map не хранит топологический порядок).
 * Сервер применяет батч строго по порядку и отклонит `item.create` ребёнка,
 * если родитель с таким `parentId` ещё не создан на этом шаге, — без этой
 * перестановки undo батча, удалившего контейнер и его ребёнка одновременно,
 * мог целиком провалиться на сервере, пока клиент уже применил его локально
 * (расхождение до перезагрузки). Вложенность — один уровень, второй проход
 * не нужен.
 */
function reorderContainerCreatesFirst(ops: BoardOp[]): BoardOp[] {
  const creates = new Map<string, BoardOp & { type: 'item.create' }>();
  for (const op of ops) {
    if (op.type === 'item.create') creates.set(op.item.id, op);
  }
  const result: BoardOp[] = [];
  const emitted = new Set<string>();
  for (const op of ops) {
    if (op.type !== 'item.create') {
      result.push(op);
      continue;
    }
    if (emitted.has(op.item.id)) continue;
    const parentId = op.item.parentId;
    const parentCreate = parentId ? creates.get(parentId) : undefined;
    if (parentCreate && !emitted.has(parentId!)) {
      result.push(parentCreate);
      emitted.add(parentId!);
    }
    result.push(op);
    emitted.add(op.item.id);
  }
  return result;
}

/** Свежий `clientOpId` на каждый повторный прогон — переиспользованный id из старой записи истории мог бы столкнуться с уже разрешённым в `ownClientOpIds` */
export function regenerateClientOpIds(ops: BoardOp[]): BoardOp[] {
  return ops.map((op) => ({ ...op, clientOpId: uuid() }));
}

/**
 * Отбрасывает операции, чья цель уже удалена другим участником — сервер
 * отклонил бы `*.patch`/`*.delete` на несуществующий id и завалил бы весь
 * батч целиком, включая соседние ещё валидные операции той же записи истории.
 *
 * `willExistItemIds` — id элементов, которые ЕЩЁ появятся из `item.create` в
 * этом же батче (восстановление удалённой карточки и её связей — один и тот
 * же undo entry, см. `deriveInverseOps`): без этого `edge.create` рядом с
 * "своим" `item.create` отбрасывался бы как ссылающийся на несуществующий id,
 * хотя после применения батча по порядку элемент уже будет на месте.
 */
export function filterExistingTargets(ops: BoardOp[], local: BoardLocalState): BoardOp[] {
  const willExistItemIds = new Set(local.items.keys());
  for (const op of ops) {
    if (op.type === 'item.create') willExistItemIds.add(op.item.id);
  }

  return ops.filter((op) => {
    switch (op.type) {
      case 'item.create':
        return true;
      case 'item.patch':
      case 'item.delete':
      case 'item.react':
        return local.items.has(op.id);
      case 'edge.create':
        return (
          willExistItemIds.has(op.edge.sourceItemId) && willExistItemIds.has(op.edge.targetItemId)
        );
      case 'edge.patch':
      case 'edge.delete':
        return local.edges.has(op.id);
    }
  });
}
