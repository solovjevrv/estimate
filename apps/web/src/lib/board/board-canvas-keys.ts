/**
 * Provide/inject-ключи для передачи состояния холста вниз в узлы Vue Flow
 * (12.6) — `data` узла жёстко типизирован под `BoardItem` в `vue-flow-adapter.ts`,
 * поэтому право редактирования и id только что созданного элемента (для
 * автофокуса в текст) идут отдельным каналом, а не через `data`.
 */
import type { InjectionKey, Ref } from 'vue';

export const BOARD_CAN_EDIT_KEY: InjectionKey<Ref<boolean>> = Symbol('boardCanEdit');
export const BOARD_PENDING_EDIT_ID_KEY: InjectionKey<Ref<string | null>> =
  Symbol('boardPendingEditId');
