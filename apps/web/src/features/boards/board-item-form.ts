import { BOARD_SHAPE_KINDS } from '@poker/shared';

/**
 * Вид формы/контента элемента доски — используется единым переключателем
 * «тип элемента» в плавающем тулбаре выделения (12.7) и в `useBoardSelection`.
 * Перенесён из `BoardSelectionToolbar.vue`, чтобы composable не импортировал
 * Vue-компоненты (адаптерные типы — в feature-модуль, а не в .vue).
 */
export type ItemFormKind =
  | 'sticky'
  | (typeof BOARD_SHAPE_KINDS)[number]
  | 'text'
  | 'image'
  | 'emoji'
  | 'sticker'
  | 'frame'
  | 'group';
