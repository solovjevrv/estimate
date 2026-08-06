/**
 * Применение закоммиченной операции доски к локальному состоянию клиента
 * (12.4). В отличие от серверного `applyBoardOp` (валидирует и мутирует
 * состояние из сырых операций), здесь операции уже подтверждены сервером и
 * несут целиком собранную запись — применение сводится к простому upsert/delete
 * по id, без валидации и без мержа патча.
 */
import type { BoardCommittedOp, BoardEdge, BoardItem } from '@poker/shared';

export interface BoardLocalState {
  items: Map<string, BoardItem>;
  edges: Map<string, BoardEdge>;
}

export function applyLocalBoardOp(state: BoardLocalState, op: BoardCommittedOp): void {
  switch (op.type) {
    case 'item.create':
    case 'item.patch':
      state.items.set(op.item.id, op.item);
      break;
    case 'item.delete':
      state.items.delete(op.id);
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
