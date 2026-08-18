/**
 * Применение закоммиченной операции доски к локальному состоянию клиента
 * (12.4). В отличие от серверного `applyBoardOp` (валидирует и мутирует
 * состояние из сырых операций), здесь операции уже подтверждены сервером и
 * несут целиком собранную запись — применение сводится к простому upsert/delete
 * по id, без валидации и без мержа патча.
 */
import type { BoardCommittedOp, BoardEdge, BoardItem } from '@poker/shared';
import { isBoardContainer } from '@poker/shared';

export interface BoardLocalState {
  items: Map<string, BoardItem>;
  edges: Map<string, BoardEdge>;
}

export function applyLocalBoardOp(state: BoardLocalState, op: BoardCommittedOp): void {
  switch (op.type) {
    case 'item.create':
    case 'item.patch': {
      const existing = state.items.get(op.item.id);
      state.items.set(op.item.id, op.item);
      // Если патч демотировал контейнер (frame/group) до обычного элемента —
      // осираем детей локально (parentId → null), зеркалируя server board-ops.ts.
      if (
        existing &&
        isBoardContainer(existing.content.type) &&
        !isBoardContainer(op.item.content.type)
      ) {
        for (const child of state.items.values()) {
          if (child.parentId === op.item.id) child.parentId = null;
        }
      }
      break;
    }
    case 'item.delete':
      state.items.delete(op.id);
      // Сервер каскадно удаляет связи удалённого элемента (board-ops.ts), но
      // рассылает только сам item.delete — без этого локальный edges оставался
      // бы с "осиротевшей" связью на несуществующий узел. Vue Flow при
      // следующем ре-рендере падает с TypeError (source/target для неё не
      // находится в node-lookup), что молча ломает реактивность холста
      // ЦЕЛИКОМ до перезагрузки страницы — баг, найденный пользователем
      // 08.08.2026 (удаление карточки со стрелкой не отражалось в реальном
      // времени). Зеркалим тот же каскад здесь — единая точка и для
      // оптимистичного предсказания, и для применения эха/чужих рассылок.
      for (const [edgeId, edge] of state.edges) {
        if (edge.sourceItemId === op.id || edge.targetItemId === op.id) {
          state.edges.delete(edgeId);
        }
      }
      // Удаление контейнера (frame/group, 14.3) НЕ каскадит детей — они
      // осираются (parentId → null), остаются на доске. Сервер делает
      // то же самое через DB-FK ON DELETE SET NULL + board-ops.ts, а здесь
      // зеркалируем в памяти — иначе локальная копия ребёнка следующего
      // batch-оператора увидела бы уже уничтоженный parentNode через Vue Flow.
      for (const child of state.items.values()) {
        if (child.parentId === op.id) child.parentId = null;
      }
      break;
    case 'edge.create':
    case 'edge.patch':
      state.edges.set(op.edge.id, op.edge);
      break;
    case 'edge.delete':
      state.edges.delete(op.id);
      break;
  }
}
