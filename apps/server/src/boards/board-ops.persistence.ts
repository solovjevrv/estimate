import type { BoardCommittedOp, BoardOp } from '@estimate/shared';

import type { BoardOpState } from './board-ops';
import type { BoardsRepository } from './boards.repository';

type PersistRepository = Pick<
  BoardsRepository,
  'insertItem' | 'updateItem' | 'deleteItem' | 'insertEdge' | 'updateEdge' | 'deleteEdge'
>;

export interface PersistBoardOpsContext {
  repository: PersistRepository;
  boardId: string;
  actorUserId: string | null;
  state: BoardOpState;
}

type PersistedOp = BoardCommittedOp | null;
type PersistHandler = (context: PersistBoardOpsContext, op: BoardOp) => Promise<PersistedOp>;

/** Сохраняет точный тип обработчика в таблице, а dispatch остаётся без switch. */
function forOp<T extends BoardOp['type']>(
  handler: (
    context: PersistBoardOpsContext,
    op: Extract<BoardOp, { type: T }>,
  ) => Promise<PersistedOp>,
): PersistHandler {
  return (context, op) => handler(context, op as Extract<BoardOp, { type: T }>);
}

/**
 * Персист-фаза выполняется только после полного `applyBoardOp` всего батча.
 * Поэтому create/patch берут запись из state, а не сырые данные операции:
 * иначе можно было бы записать в БД не прошедшие валидацию поля.
 */
const PERSIST_BY_TYPE: Record<BoardOp['type'], PersistHandler> = {
  'item.create': forOp<'item.create'>(async ({ repository, boardId, actorUserId, state }, op) => {
    const draft = state.items.get(op.item.id);
    if (!draft) return null;
    const item = await repository.insertItem(boardId, actorUserId, draft);
    return { type: 'item.create', clientOpId: op.clientOpId, item };
  }),
  'item.patch': forOp<'item.patch'>(async ({ repository, boardId, state }, op) => {
    const draft = state.items.get(op.id);
    if (!draft) return null;
    const item = await repository.updateItem(boardId, op.id, draft);
    return item ? { type: 'item.patch', clientOpId: op.clientOpId, item } : null;
  }),
  'item.delete': forOp<'item.delete'>(async ({ repository, boardId }, op) => {
    await repository.deleteItem(boardId, op.id);
    return { type: 'item.delete', clientOpId: op.clientOpId, id: op.id };
  }),
  // Реакция рассылается как полная запись item.patch: клиентам не нужен отдельный протокол.
  'item.react': forOp<'item.react'>(async ({ repository, boardId, state }, op) => {
    const draft = state.items.get(op.id);
    if (!draft) return null;
    const item = await repository.updateItem(boardId, op.id, draft);
    return item ? { type: 'item.patch', clientOpId: op.clientOpId, item } : null;
  }),
  'edge.create': forOp<'edge.create'>(async ({ repository, boardId, state }, op) => {
    const draft = state.edges.get(op.edge.id);
    if (!draft) return null;
    const edge = await repository.insertEdge(boardId, draft);
    return { type: 'edge.create', clientOpId: op.clientOpId, edge };
  }),
  'edge.patch': forOp<'edge.patch'>(async ({ repository, boardId, state }, op) => {
    const draft = state.edges.get(op.id);
    if (!draft) return null;
    const edge = await repository.updateEdge(boardId, op.id, draft);
    return edge ? { type: 'edge.patch', clientOpId: op.clientOpId, edge } : null;
  }),
  'edge.delete': forOp<'edge.delete'>(async ({ repository, boardId }, op) => {
    await repository.deleteEdge(boardId, op.id);
    return { type: 'edge.delete', clientOpId: op.clientOpId, id: op.id };
  }),
};

/** Сохраняет операции строго в их исходном порядке для детерминированной WS-рассылки. */
export async function persistBoardOps(
  context: PersistBoardOpsContext,
  ops: readonly BoardOp[],
): Promise<BoardCommittedOp[]> {
  const committed: BoardCommittedOp[] = [];
  for (const op of ops) {
    const persisted = await PERSIST_BY_TYPE[op.type](context, op);
    if (persisted) committed.push(persisted);
  }
  return committed;
}
