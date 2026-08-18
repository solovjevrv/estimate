/**
 * Редактирование форматированного текста стикера/фигуры (12.13) — вынесено в
 * composable, а не продублировано в `BoardStickyNode.vue`/`BoardShapeNode.vue`
 * (у них и так уже одинаковая механика contenteditable, отличается только
 * форма `content`), чтобы баги вроде описанных ниже чинились в одном месте.
 *
 * Три нетривиальных бага с фокусом, найденных ревью и живой проверкой в
 * браузере (автотесты через `page.mouse` их не ловят — Selection API в
 * headless Chromium не всегда точно повторяет поведение живого драга мышью)
 * и закрытых здесь:
 *
 * 1. **Клик по кнопке тулбара «съедал» выделение.** Клик по любой кнопке в
 *    `BoardSelectionToolbar` (рендерится вне contenteditable, на уровне
 *    `BoardCanvas`) браузер сначала обрабатывает как смену фокуса —
 *    `mousedown` уводит фокус с contenteditable на кнопку/попап ДО того, как
 *    отработает `click`, и `@blur` уже успевал вызвать `commitEditing()`
 *    (гасит `editing`, размонтирует contenteditable), так что к моменту
 *    клика редактировать было уже нечего. Кнопки, применяющиеся к текущему
 *    выделению (начертание/маркер/ссылка), гасят `mousedown.prevent` в самом
 *    `BoardSelectionToolbar.vue` — тогда фокус не уходит вовсе.
 * 2. **Ввод ссылки — единственный случай, где фокус ДОЛЖЕН уйти** (в поле
 *    URL) — `mousedown.prevent` тут не спасает. Вместо `blur` →
 *    `commitEditing()` — точечная проверка `relatedTarget`: если фокус ушёл
 *    именно в тулбар (`BOARD_TEXT_TOOLBAR_SELECTOR`), коммит откладывается, а не
 *    срывается — иначе `editableEl` размонтировался бы раньше, чем придёт
 *    `setLink(url)`. Финальный коммит всё равно гарантировано случится по
 *    `watch(isSelected)`, когда пользователь реально кликнет мимо (снятие
 *    выделения в Vue Flow не зависит от DOM-фокуса).
 * 3. **`Selection.addRange()` сам неявно фокусирует contenteditable в
 *    Chromium**, даже без явного `.focus()` — значит восстановление выделения
 *    сразу после клика по кнопке (жирный, маркер...) само срабатывает как
 *    уход фокуса из попапа тулбара, а Reka по умолчанию закрывает попап, как
 *    только фокус покидает триггер/контент (`focus-outside`). Решение — не
 *    отказ от восстановления (см. баг 5 ниже, куда это отсутствие завело), а
 *    точечное отключение именно этого триггера закрытия: попапы начертания и
 *    маркера в `BoardSelectionToolbar.vue` передают `onFocusOutside` в
 *    `:content`, гасящий именно это событие (`pointerDownOutside` — обычное
 *    «кликнули мимо» — не тронут, попап закрывается им как раньше).
 * 4. **`BOARD_TEXT_TOOLBAR_SELECTOR` заводили как «весь тулбар», потом сузили
 *    до «только попап ссылки».** Широкий вариант защищал `onEditableBlur` от
 *    коммита при клике по ЛЮБОЙ кнопке тулбара — но Цвет/Форма/Дублировать/
 *    Удалить не используют `editableEl` и не должны мешать обычному коммиту:
 *    клик «Дублировать» посреди набора текста переставал сохранять черновик
 *    (коммит просто не срабатывал), копируя старое содержимое — тихая потеря
 *    данных, найденная ревью, не живой проверкой. Committing on blur для этих
 *    кнопок — штатное, безопасное поведение (черновик сохраняется, просто
 *    выходим из режима редактирования), как было до 12.13.
 * 5. **Первая версия фикса бага 3 вообще не трогала `window.getSelection()`
 *    после патча** (пересчитывала пресс-стейт кнопок напрямую из runs, не
 *    восстанавливая Range) — но `renderRunsInto` пересобирает DOM
 *    (`el.textContent=''` + заново), а когда узел-граница Range удаляется,
 *    спецификация переносит границу к родителю на позицию 0: курсор молча
 *    улетал в начало текста, и следующий набранный символ (если пользователь
 *    продолжал печатать без повторного клика в текст) вставлялся не туда.
 *    Найдено ревью, не живой проверкой. `applyRangePatch` теперь зовёт
 *    `selectRange` всегда — фикс бага 3 (`onFocusOutside`) как раз и позволяет
 *    это делать, не закрывая попап.
 *
 * 6. **Форматирование без выделения (18.7).** После клика внутри текста без
 *    drag selection схлопывается (cursor без выделения) — `hasTextSelection`
 *    становится `false`, но `activeMarks` вычисляются по всему непустому тексту,
 *    и начертание/маркер применяются к нему. Ссылка же требует ЯВНОГО выделения:
 *    `setLink` использует только сохранённый `lastOffsets` и не получает
 *    fallback «весь текст», иначе пользователь случайно превратил бы всю
 *    подпись в ссылку при вводе URL.
 */
import {
  BOARD_ITEM_TEXT_MAX_LENGTH,
  type BoardHighlightColor,
  type BoardItemContent,
  type BoardTextMark,
  type BoardTextRun,
} from '@poker/shared';
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
  type Ref,
} from 'vue';
import { useToast } from '@nuxt/ui/composables';
import { useI18n } from 'vue-i18n';

import {
  BOARD_ACTIVE_TEXT_EDITOR_KEY,
  BOARD_PENDING_EDIT_ID_KEY,
} from '../context/board-canvas-keys';
import {
  applyMarkToRange,
  BOARD_TEXT_TOOLBAR_SELECTOR,
  getActiveMarks,
  getSelectionOffsets,
  insertPlainTextAtCaret,
  renderRunsInto,
  runsFromContent,
  runsPlainText,
  selectRange,
  serializeRuns,
  truncateRuns,
  type BoardTextEditorHandle,
} from '../rich-text/board-rich-text';
import { useBoardSessionStore } from '../../../stores/board-session';

export type FormatMarkKey = 'bold' | 'italic' | 'underline' | 'strike';

export interface UseRichTextEditingOptions<TContent extends BoardItemContent> {
  itemId: string;
  canEdit: Ref<boolean>;
  /** `props.selected` из Vue Flow — не зависит от DOM-фокуса, надёжный сигнал «ушли отсюда» */
  isSelected: Ref<boolean>;
  content: Ref<TContent>;
  buildContent: (text: string, runs: BoardTextRun[] | undefined) => TContent;
}

export function useRichTextEditing<TContent extends BoardItemContent>(
  options: UseRichTextEditingOptions<TContent>,
) {
  const { itemId, canEdit, isSelected, content, buildContent } = options;
  const boardSession = useBoardSessionStore();
  const { t } = useI18n();
  const toast = useToast();

  /**
   * Мягкая блокировка (14.2): если элемент сейчас редактирует ДРУГОЙ участник —
   * возвращаем его запись, чтобы UI показывал бейдж и блокировал вход в редактирование.
   * Своя же блокировка (`participantId` совпадает с текущим участником) в `lockedBy`
   * не попадает — чтобы можно было снять выделение и заново войти в редактирование
   * своего же элемента.
   */
  const lockedBy = computed(() => {
    const lock = boardSession.editingByItem.get(itemId);
    return lock && lock.participantId !== boardSession.participantId ? lock : null;
  });
  const pendingEditId = inject(BOARD_PENDING_EDIT_ID_KEY, ref(null));
  const activeTextEditor = inject(BOARD_ACTIVE_TEXT_EDITOR_KEY, shallowRef(null));

  const displayRuns = computed(() => runsFromContent(content.value));

  const editing = ref(false);
  /** Только триггер для авто-fit (см. use-fit-font-size.ts) — источник правды в момент редактирования сам DOM */
  const liveText = ref('');
  /** `ref="editable"` в шаблоне компонента, вызвавшего этот composable — регистрация
   *  привязана к текущему инстансу компонента, а не лексически к этому файлу */
  const editableEl = useTemplateRef<HTMLElement>('editable');

  /** Пресс-стейт кнопок форматирования — пересчитывается по изменению выделения */
  const activeMarksRef = ref<BoardTextMark | null>(null);
  /** `true` только при фактическом непустом DOM-выделении. Различает два режима (18.7):
   *  - выделение есть → ссылка доступна;
   *  - выделения нет (cursor), но текст непуст → начертание/маркер применяются ко всему тексту. */
  const hasTextSelection = ref(false);
  /** Последний непустой диапазон выделения — кнопки тулбара мышью его не теряют
   *  (mousedown.prevent), а вводу ссылки нужен снимок ДО того, как фокус уйдёт в поле URL */
  let lastOffsets: { start: number; end: number } | null = null;
  /** Растёт при каждом применении начертания/маркера/ссылки — компонент узла
   *  подмшивает его в зависимости `useFitFontSize`, см. `applyRangePatch` */
  const formatTick = ref(0);

  /**
   * Целевой диапазон для начертания/маркера (18.7):
   * 1. текущее непустое выделение, если оно есть (`lastOffsets`, когда
   *    `hasTextSelection === true`);
   * 2. иначе весь непустой текст `[0, text.length)`.
   * Возвращает `null` для пустого текста — его не форматировать и не создавать
   * пустых `runs`.
   */
  function resolveFormatRange(runs: BoardTextRun[]): { start: number; end: number } | null {
    if (hasTextSelection.value && lastOffsets) return lastOffsets;
    const len = runsPlainText(runs).length;
    if (len > 0) return { start: 0, end: len };
    return null;
  }

  function refreshActiveMarks(): void {
    const el = editableEl.value;
    if (!el) {
      activeMarksRef.value = null;
      hasTextSelection.value = false;
      return;
    }
    const offsets = getSelectionOffsets(el);
    if (offsets) {
      lastOffsets = offsets;
      hasTextSelection.value = true;
      activeMarksRef.value = getActiveMarks(serializeRuns(el), offsets.start, offsets.end);
    } else {
      hasTextSelection.value = false;
      const runs = serializeRuns(el);
      const textLen = runsPlainText(runs).length;
      activeMarksRef.value = textLen > 0 ? getActiveMarks(runs, 0, textLen) : null;
    }
  }

  /**
   * Применяет патч к целевому диапазону (см. `resolveFormatRange`) и обновляет
   * пресс-стейт кнопок БЕЗ обращения к `window.getSelection()` — важно: в
   * Chromium `Selection.addRange()` внутри contenteditable сама неявно
   * фокусирует его, даже без явного `.focus()` (проверено на живой доске).
   * Попапы тулбара (Reka) закрываются сами, как только фокус уходит за
   * пределы триггера/контента, так что любая попытка «вернуть» видимое
   * выделение сразу после клика по кнопке молча схлопывала попап — второй
   * клик подряд (например, италик сразу за жирным) уже бил в закрытое меню.
   * Поэтому `lastOffsets` умышленно НЕ обновляется отсюда через живой
   * `window.getSelection()` — переиспользуется тот же диапазон, что и был
   * до первого клика, пока пользователь не выделит текст заново сам.
   */
  function applyRangePatch(patch: (marks: BoardTextMark) => BoardTextMark): void {
    const el = editableEl.value;
    if (!el) return;
    const runs = serializeRuns(el);
    const offsets = resolveFormatRange(runs);
    if (!offsets) return;
    const next = applyMarkToRange(runs, offsets.start, offsets.end, patch);
    renderRunsInto(el, next);
    // Диапазон обязательно восстанавливаем: `renderRunsInto` пересобирает DOM
    // (`el.textContent = ''` + заново), а когда узел-граница Range удаляется,
    // спецификация переносит границу к родителю на позицию 0 — без этого курсор
    // молча улетел бы в начало текста, и следующий набранный символ вставлялся
    // бы не туда (ловилось не вручную, а самим ревью). `selectRange` неявно
    // фокусирует contenteditable в Chromium — Reka закрыла бы попап тулбара по
    // `focus-outside`, поэтому у попапов начертания/маркера в
    // `BoardSelectionToolbar.vue` этот конкретный триггер закрытия отключён
    // (`onFocusOutside` в `:content`), а обычное «кликнули мимо» продолжает
    // закрывать попап как раньше (это отдельное, не тронутое событие).
    selectRange(el, offsets.start, offsets.end);
    activeMarksRef.value = getActiveMarks(next, offsets.start, offsets.end);
    // Жирное/зачёркнутое начертание меняет ширину текста без изменения его длины
    // (`liveText` не поменялась бы) — `useFitFontSize` в компоненте узла следит
    // и за этим тиком, чтобы пересчитать размер шрифта под новую ширину, а не
    // только по факту набора новых символов
    formatTick.value += 1;
  }

  function toggleMark(key: FormatMarkKey): void {
    const active = activeMarksRef.value;
    applyRangePatch((marks) => ({ ...marks, [key]: !active?.[key] }));
  }

  function setHighlight(color: BoardHighlightColor | null): void {
    applyRangePatch((marks) => ({ ...marks, highlight: color ?? undefined }));
  }

  /**
   * Ссылка работает ТОЛЬКО с сохранённым непустым выделением (`lastOffsets`),
   * не получая fallback «весь текст» (18.7) — иначе пользователь случайно
   * превратил бы всю подпись в ссылку, когда поставил cursor в текст и кликнул
   * иконку ссылки.
   */
  function setLink(url: string | null): void {
    const el = editableEl.value;
    const offsets = lastOffsets;
    // Ссылка требует фактического непустого выделения — без него (схлопнутый cursor)
    // не применяем fallback «весь текст» (18.7), даже если lastOffsets сохранился
    // от предыдущего выделения (например, авто-выделения при входе в редактирование).
    if (!el || !offsets || !hasTextSelection.value) return;
    const runs = serializeRuns(el);
    const next = applyMarkToRange(runs, offsets.start, offsets.end, (marks) => ({
      ...marks,
      link: url ?? undefined,
    }));
    renderRunsInto(el, next);
    selectRange(el, offsets.start, offsets.end);
    activeMarksRef.value = getActiveMarks(next, offsets.start, offsets.end);
    formatTick.value += 1;
  }

  function releaseActiveEditor(): void {
    if (activeTextEditor.value?.itemId === itemId) activeTextEditor.value = null;
  }

  async function startEditing(): Promise<void> {
    if (editing.value || !canEdit.value) return;
    // На доске должен быть только один активный contenteditable. Иначе быстрое
    // создание или двойной клик по разным элементам оставляет несколько
    // редакторов, а drag по ним больше не доходит до Vue Flow.
    activeTextEditor.value?.commit();
    // Вмешательство в работу другого участника — снимаем follow-mode (14.5)
    if (boardSession.followedParticipantId) {
      boardSession.stopFollowing();
    }
    if (lockedBy.value) {
      toast.add({
        title: t('board.editingLocked', { name: lockedBy.value.name }),
        color: 'warning',
      });
      return;
    }
    editing.value = true;
    // Проверка типа: composable используется только для текстовых типов контента
    const c = content.value as { type: string; text?: string; runs?: BoardTextRun[] };
    if (c.type === 'image') return;
    liveText.value = c.text ?? '';
    // Регистрируемся ДО await nextTick(): два dblclick подряд могут запустить
    // startEditing() у разных нод в одном тике. Без ранней регистрации второй
    // вызов ещё не видит первого редактора и оба contenteditable остаются
    // активными. commit() у первого ниже сбросит editing, а guard после
    // nextTick не даст ему поздно перехватить фокус обратно.
    activeTextEditor.value = {
      itemId,
      activeMarks: activeMarksRef,
      hasTextSelection,
      toggle: toggleMark,
      setHighlight,
      setLink,
      commit: commitEditing,
    } satisfies BoardTextEditorHandle;
    await nextTick();
    if (!editing.value || activeTextEditor.value?.itemId !== itemId) return;
    const el = editableEl.value;
    if (el) {
      renderRunsInto(el, runsFromContent(content.value));
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      // Без этого activeMarksRef/lastOffsets переживали бы из предыдущей сессии
      // редактирования того же (переиспользуемого) инстанса компонента — тулбар
      // показал бы "начертание активно" от старого выделения, а клик применил
      // бы патч к диапазону, оставшемуся от прошлого раза, а не к «выделить всё»
      refreshActiveMarks();
    }
  }

  onMounted(() => {
    if (pendingEditId.value === itemId) {
      pendingEditId.value = null;
      void startEditing();
    }
  });

  onBeforeUnmount(releaseActiveEditor);

  function commitEditing(): void {
    if (!editing.value) return;
    editing.value = false;
    releaseActiveEditor();
    const el = editableEl.value;
    if (!el) return;
    let runs = serializeRuns(el);
    if (runsPlainText(runs).length > BOARD_ITEM_TEXT_MAX_LENGTH) {
      runs = truncateRuns(runs, BOARD_ITEM_TEXT_MAX_LENGTH);
    }
    const text = runsPlainText(runs);
    const hasFormatting = runs.some((run) => run.marks);
    const nextContent = buildContent(text, hasFormatting ? runs : undefined);
    const existing = buildContent(
      (content.value as { text?: string }).text ?? '',
      (content.value as { runs?: BoardTextRun[] }).runs?.length
        ? (content.value as { runs?: BoardTextRun[] }).runs
        : undefined,
    );
    if (JSON.stringify(nextContent) === JSON.stringify(existing)) return;
    void boardSession.applyOps([
      {
        type: 'item.patch',
        clientOpId: crypto.randomUUID(),
        id: itemId,
        patch: { content: nextContent },
      },
    ]);
  }

  function cancelEditing(): void {
    editing.value = false;
    releaseActiveEditor();
  }

  /** Vue Flow снимает выделение независимо от DOM-фокуса — надёжный сигнал «точно ушли отсюда»,
   *  даже если фокус застрял в поле ссылки тулбара и обычный blur не долетел до commitEditing() */
  watch(isSelected, (selected) => {
    if (!selected && editing.value) commitEditing();
  });

  /**
   * Единая точка рассылки блокировки (14.2) — реагирует на ЛЮБОЕ изменение `editing`,
   * независимо от того, какой код его вызвал: commitEditing/cancelEditing/
   * watch(isSelected)/onEditableBlur. Если расставить sendAwareness('editing')
   * в каждом из выходов по отдельности — велик риск забыть один путь и оставить
   * блокировку висеть, пока вкладка живёт. `canEdit` глушит рассылку для зрителей —
   * блокировку шлёт только редактор, как и курсор.
   *
   * Следование за фактическим значением ref (а не за конкретным вызовом) также
   * нейтрализует гонку 12.26: `startEditing()`'s `await nextTick()` может
   * резолвиться после снятия выделения, и `editing` может залипнуть в true —
   * поведение остаётся корректным, потому что рассылка следует за итоговым
   * значением, а не за тем, как оно достигнуто. Саму гонку 12.26 не чиним — это
   * отдельный бэклог-пункт.
   */
  watch(editing, (isEditing) => {
    if (!canEdit.value) return;
    void boardSession.sendAwareness('editing', { itemId, active: isEditing });
  });

  function onEditableBlur(event: FocusEvent): void {
    const related = event.relatedTarget;
    if (related instanceof HTMLElement && related.closest(BOARD_TEXT_TOOLBAR_SELECTOR)) return;
    commitEditing();
  }

  function onEditableInput(): void {
    liveText.value = editableEl.value?.textContent ?? '';
  }

  function onEditableKeydownEnter(event: KeyboardEvent): void {
    event.preventDefault();
    const el = editableEl.value;
    if (!el) return;
    // preventDefault выше не даёт дойти до beforeinput — тот же лимит длины
    // приходится проверять здесь заново, иначе Enter мог бы расти сколько угодно
    const selection = window.getSelection();
    const selectedLength = selection && !selection.isCollapsed ? selection.toString().length : 0;
    if ((el.textContent ?? '').length - selectedLength >= BOARD_ITEM_TEXT_MAX_LENGTH) return;
    insertPlainTextAtCaret('\n');
    onEditableInput();
  }

  /**
   * `insertType`, растящие контент вручную под нашим контролем (проверяем
   * лимит длины ниже) — единственное, что реально проверено/протестировано
   * (`onEditableKeydownEnter` для Enter, `onEditablePaste` для вставки).
   */
  const GROWING_INPUT_TYPES = [
    'insertText',
    'insertCompositionText',
    'insertParagraph',
    'insertLineBreak',
  ];
  function onEditableBeforeInput(event: InputEvent): void {
    const el = editableEl.value;
    if (!el) return;
    // Удаление (все типы 'delete*' спека — deleteContentBackward/ByCut/WordForward/...)
    // никогда не растит контент и не может нарушить лимит длины — разрешаем
    // безусловно, иначе Backspace/Delete/Cut перестали бы работать.
    if (event.inputType.startsWith('delete')) return;
    // historyUndo/historyRedo — нативный undo/redo браузера НЕ отслеживает наши
    // программные перестройки DOM (`renderRunsInto` — el.textContent='' + rebuild),
    // только реальный пользовательский ввод (insertText и т.п.), так что откатывать
    // тут нечего, кроме уже провалидированного текста — безопасно пропускать не глядя
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') return;
    if (!GROWING_INPUT_TYPES.includes(event.inputType)) {
      // Всё, что мы явно не поддерживаем сами (нативные команды форматирования
      // Ctrl+B, drag&drop чужого текста/HTML — `insertFromDrop`, замена через
      // подсказки браузера и т.п.) — блокируем целиком: не доверяем браузеру
      // ни структуру DOM, которую он вставит, ни то, что она уложится в лимит
      event.preventDefault();
      return;
    }
    const selection = window.getSelection();
    const selectedLength = selection && !selection.isCollapsed ? selection.toString().length : 0;
    if ((el.textContent ?? '').length - selectedLength >= BOARD_ITEM_TEXT_MAX_LENGTH) {
      event.preventDefault();
    }
  }

  function onEditablePaste(event: ClipboardEvent): void {
    event.preventDefault();
    const el = editableEl.value;
    if (!el) return;
    const selection = window.getSelection();
    const selectedLength = selection && !selection.isCollapsed ? selection.toString().length : 0;
    const budget = Math.max(
      0,
      BOARD_ITEM_TEXT_MAX_LENGTH - (el.textContent ?? '').length + selectedLength,
    );
    const text = (event.clipboardData?.getData('text/plain') ?? '').slice(0, budget);
    if (text.length === 0) return;
    insertPlainTextAtCaret(text);
    onEditableInput();
  }

  return {
    displayRuns,
    editing,
    lockedBy,
    liveText,
    formatTick,
    editableEl,
    startEditing,
    commitEditing,
    cancelEditing,
    refreshActiveMarks,
    onEditableBlur,
    onEditableInput,
    onEditableKeydownEnter,
    onEditableBeforeInput,
    onEditablePaste,
  };
}
