/** Общие типы и контракты, используемые фронтендом и бэкендом. */

import type { ReactionEmoji } from '../rooms';
import type { BoardEdge, BoardEdgeStyle, BoardItem, BoardItemStyle } from './entities';

interface BoardOpBase {
  /** id операции с клиента — по нему клиент отличает подтверждение своей же операции от чужой */
  clientOpId: string;
}

/** Id элемента генерирует клиент (UUID) — сервер просто сохраняет его как есть */
export interface BoardItemCreateOp extends BoardOpBase {
  type: 'item.create';
  item: Omit<BoardItem, 'boardId' | 'createdBy' | 'updatedAt'>;
}

export interface BoardItemPatchOp extends BoardOpBase {
  type: 'item.patch';
  id: string;
  patch: Partial<
    Omit<BoardItem, 'id' | 'boardId' | 'createdBy' | 'updatedAt' | 'style' | 'reactions'>
  > & {
    /** Партиал, не целиком (12.9) — мержится поверх текущего style, а не заменяет его */
    style?: Partial<BoardItemStyle>;
  };
}

export interface BoardItemDeleteOp extends BoardOpBase {
  type: 'item.delete';
  id: string;
}

/**
 * Реакция-тоггл (12.12) — отдельный op, не поле `item.patch`: `emoji` сам по
 * себе не говорит, добавить реакцию или снять — решает СЕРВЕР, авторитетно
 * сравнивая с уже стоящей реакцией автора на этот элемент (под той же
 * блокировкой строки доски, что и остальные операции батча). Если бы это было
 * полем в `patch`, клиент мог бы прислать произвольный итоговый список и
 * обойти toggle-логику.
 */
export interface BoardItemReactOp extends BoardOpBase {
  type: 'item.react';
  id: string;
  emoji: ReactionEmoji;
}

export interface BoardEdgeCreateOp extends BoardOpBase {
  type: 'edge.create';
  edge: Omit<BoardEdge, 'boardId'>;
}

/**
 * `sourceItemId`/`targetItemId` — ручное перецепление конца связи на другой
 * элемент (12.20, Miro/Figma-приём: перетащить конец существующей стрелки на
 * другой хендл). Приходят вместе с `sourceHandle`/`targetHandle` одним атомарным
 * патчем — Vue Flow отдаёт оба конца и обе стороны крепления сразу в одном
 * событии `connection`, отдельного протокола на "только сторона" vs "элемент
 * целиком" не заводим.
 */
export interface BoardEdgePatchOp extends BoardOpBase {
  type: 'edge.patch';
  id: string;
  patch: Partial<
    Pick<BoardEdge, 'sourceItemId' | 'targetItemId' | 'sourceHandle' | 'targetHandle' | 'label'>
  > & {
    style?: Partial<BoardEdgeStyle>;
  };
}

export interface BoardEdgeDeleteOp extends BoardOpBase {
  type: 'edge.delete';
  id: string;
}

/** Дискриминированный union по `type` — та же идея, что у `BoardItemContent` */
export type BoardOp =
  | BoardItemCreateOp
  | BoardItemPatchOp
  | BoardItemDeleteOp
  | BoardItemReactOp
  | BoardEdgeCreateOp
  | BoardEdgePatchOp
  | BoardEdgeDeleteOp;

/** Верхняя граница числа операций в одном вызове `board:apply` — защита от гигантского батча */
export const BOARD_OPS_BATCH_MAX = 50;
/** Сколько последних батчей операций держим в памяти на доску — догон дальше не работает */
export const BOARD_RING_BUFFER_SIZE = 200;
