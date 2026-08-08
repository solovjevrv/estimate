/**
 * Provide/inject-ключи для передачи состояния холста вниз в узлы Vue Flow
 * (12.6) — `data` узла жёстко типизирован под `BoardItem` в `vue-flow-adapter.ts`,
 * поэтому право редактирования и id только что созданного элемента (для
 * автофокуса в текст) идут отдельным каналом, а не через `data`.
 */
import type { InjectionKey, Ref } from 'vue';

import type { BoardTextEditorHandle } from './board-rich-text';

export const BOARD_CAN_EDIT_KEY: InjectionKey<Ref<boolean>> = Symbol('boardCanEdit');
export const BOARD_PENDING_EDIT_ID_KEY: InjectionKey<Ref<string | null>> =
  Symbol('boardPendingEditId');
/** Id связи, которую нужно сразу открыть для ввода подписи текстом прямо на стрелке (12.8) */
export const BOARD_PENDING_EDGE_EDIT_ID_KEY: InjectionKey<Ref<string | null>> =
  Symbol('boardPendingEdgeEditId');
/** Хэндл узла, сейчас редактирующего текст (12.13) — см. `BoardTextEditorHandle` */
export const BOARD_ACTIVE_TEXT_EDITOR_KEY: InjectionKey<Ref<BoardTextEditorHandle | null>> =
  Symbol('boardActiveTextEditor');
