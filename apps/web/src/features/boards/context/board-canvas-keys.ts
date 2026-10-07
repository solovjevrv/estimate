/**
 * Provide/inject-ключи для передачи состояния холста вниз в узлы Vue Flow
 * (12.6) — `data` узла жёстко типизирован под `BoardItem` в `vue-flow-adapter.ts`,
 * поэтому право редактирования и id только что созданного элемента (для
 * автофокуса в текст) идут отдельным каналом, а не через `data`.
 */
import type { InjectionKey, Ref } from 'vue';

import type { BoardEstimate } from '../composables/use-board-estimate';
import type { BoardVotingNodeContext } from '../composables/use-board-voting';
import type { BoardTextEditorHandle } from '../rich-text/board-rich-text';
import type { ResizeAxisFlags, SnapRect } from '../domain/board-snap';

export const BOARD_CAN_EDIT_KEY: InjectionKey<Ref<boolean>> = Symbol('boardCanEdit');
/**
 * Этот пользователь сейчас тащит узел(ы) — любой, не обязательно концы
 * конкретной связи: при драге участника группы соседи и оболочка едут за ним
 * живьём (`followGroupDuringDrag`), и связи между ними должны следовать без
 * сглаживания, как и сами узлы
 */
export const BOARD_LOCAL_DRAGGING_KEY: InjectionKey<Ref<boolean>> = Symbol('boardLocalDragging');
export const BOARD_PENDING_EDIT_ID_KEY: InjectionKey<Ref<string | null>> =
  Symbol('boardPendingEditId');
/** Id связи, которую нужно сразу открыть для ввода подписи текстом прямо на стрелке (12.8) */
export const BOARD_PENDING_EDGE_EDIT_ID_KEY: InjectionKey<Ref<string | null>> =
  Symbol('boardPendingEdgeEditId');
/** Хэндл узла, сейчас редактирующего текст (12.13) — см. `BoardTextEditorHandle` */
export const BOARD_ACTIVE_TEXT_EDITOR_KEY: InjectionKey<Ref<BoardTextEditorHandle | null>> =
  Symbol('boardActiveTextEditor');

/**
 * Runtime-значения отрисованного размера текста. Это намеренно не часть
 * `BoardItem`: размер выводится из сохранённой базы, геометрии и DOM-fit и не
 * должен попасть в op-протокол/БД.
 */
export interface BoardEffectiveFontSizeRegistry {
  readonly sizes: Readonly<Ref<ReadonlyMap<string, number>>>;
  set(itemId: string, fontSize: number): void;
  remove(itemId: string): void;
}

export const BOARD_EFFECTIVE_FONT_SIZE_REGISTRY_KEY: InjectionKey<BoardEffectiveFontSizeRegistry> =
  Symbol('boardEffectiveFontSizeRegistry');

/**
 * Snap guides при изменении размера (22.3) — узел резайза не знает про соседние
 * узлы холста (только про свой `props.data`), а холст — единственный владелец
 * полного списка узлов/zoom, нужных для `computeResizeSnapGuides`. Тот же
 * приём, что и `BOARD_EFFECTIVE_FONT_SIZE_REGISTRY_KEY` выше: узел сообщает
 * наверх, холст считает и владеет состоянием (тем же `activeSnapGuides`, что
 * уже используется для drag, 19.30 — drag и resize не бывают одновременно,
 * делить один ref безопасно).
 */
export interface BoardResizeSnapContext {
  /** Live-подсказка во время resize — не мутирует геометрию, только гиды для отрисовки. */
  updateGuides(
    itemId: string,
    rect: SnapRect,
    flags: ResizeAxisFlags,
    lockAspectRatio: boolean,
  ): void;
  /** Финальный снап на resize-end — возвращает скорректированный rect (тот же rect, если снапа не было). */
  applySnap(
    itemId: string,
    rect: SnapRect,
    flags: ResizeAxisFlags,
    lockAspectRatio: boolean,
  ): SnapRect;
  clearGuides(): void;
}

export const BOARD_RESIZE_SNAP_KEY: InjectionKey<BoardResizeSnapContext> =
  Symbol('boardResizeSnap');

/**
 * Голосование точками (15.2) для бейджа голосов внутри узла — состояние и
 * снятие своей точки. Не задано (экспорт PNG, тесты узлов) — бейджей нет.
 */
export const BOARD_VOTING_KEY: InjectionKey<BoardVotingNodeContext> = Symbol('boardVoting');

/**
 * Оценка из покер-комнаты (15.6) для бейджа внутри узла. Не задано (экспорт
 * PNG, тесты узлов) — бейджей оценки нет.
 */
export const BOARD_ESTIMATE_KEY: InjectionKey<Pick<BoardEstimate, 'estimateFor'>> =
  Symbol('boardEstimate');
