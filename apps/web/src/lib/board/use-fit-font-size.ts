/**
 * Подбор размера шрифта под фиксированный бокс карточки (стикер/фигура) — не
 * бокс растёт под текст, а текст ужимается под бокс. До этого текстовое поле
 * росло по содержимому и упиралось в `max-h-full`, из-за чего при длинном
 * тексте вылезал вертикальный скролл textarea (баг, найденный пользователем
 * 07.08.2026), а режим просмотра вообще не подстраивал шрифт под размер
 * карточки — при большом тексте выглядело плохо.
 *
 * Сравниваем натуральную высоту контента (`scrollHeight` элемента с текстом)
 * с ДОСТУПНЫМ местом отдельного контейнера-бокса, а не сам элемент с собой —
 * сравнение элемента с собственным clientHeight бессмысленно, когда его
 * высота ничем не ограничена (как у `<span>` в режиме просмотра, который
 * просто растёт по контенту и центрируется родительским flex). Доступное
 * место — `clientHeight` контейнера МИНУС его собственный padding: контейнер
 * обычно и есть padded-бокс карточки (`p-4`), а clientHeight по спецификации
 * включает padding в себя — без вычитания ребёнок (textarea) считал бы себе
 * доступными на 32px больше, чем реально есть внутри отступов, и всё равно
 * переполнялся бы даже после «подгонки».
 *
 * Для `<textarea>` (режим редактирования) нужно ещё и явно управлять её
 * высотой (`manageHeight`) — у textarea, в отличие от div/span, нет
 * авторазмера по контенту, а без сброса в 'auto' перед каждым замером
 * `scrollHeight` не может УМЕНЬШИТЬСЯ ниже уже выставленной высоты. Итоговая
 * высота — натуральная (не на весь бокс), пока текст помещается «внахлёст» с
 * запасом, тогда родительский flex центрирует её как раньше; когда текст
 * заполняет весь бокс, высота просто равна боксу.
 *
 * Стартует всегда с максимума и уменьшает — без хранения "предыдущего"
 * размера, иначе укороченный текст остался бы мелким (гистерезис).
 *
 * Верхняя граница (12.9) параметризуема через `maxFontSize` — ручной выбор
 * размера в панели свойств (`BoardItemStyle.fontSize`) задаёт её вместо
 * дефолтного `FIT_FONT_MAX`, но НЕ отключает сам подбор: если текста больше,
 * чем помещается даже при выбранном размере, авто-fit всё равно ужимает
 * шрифт вплоть до `FIT_FONT_MIN` — решение пользователя 07.08.2026 (не
 * возвращать риск переполнения/скролла, который уже чинили в 12.8).
 */
import { nextTick, ref, watch, type Ref } from 'vue';

export const FIT_FONT_MIN = 10;
export const FIT_FONT_MAX = 20;

export function useFitFontSize(
  containerEl: Ref<HTMLElement | null>,
  contentEl: Ref<HTMLElement | null>,
  text: Ref<string>,
  width: Ref<number>,
  height: Ref<number>,
  /** true только для textarea в момент редактирования — у span (просмотр) высотой не управляем */
  manageHeight: Ref<boolean>,
  maxFontSize: Ref<number> = ref(FIT_FONT_MAX),
): Ref<number> {
  const fontSize = ref(maxFontSize.value);

  async function recompute(): Promise<void> {
    await nextTick();
    const container = containerEl.value;
    const content = contentEl.value;
    if (!container || !content) return;

    const containerStyle = getComputedStyle(container);
    const availableHeight =
      container.clientHeight -
      parseFloat(containerStyle.paddingTop) -
      parseFloat(containerStyle.paddingBottom);

    const shouldManageHeight = manageHeight.value;
    if (shouldManageHeight) content.style.height = 'auto';

    let size = maxFontSize.value;
    content.style.fontSize = `${size}px`;
    while (size > FIT_FONT_MIN && content.scrollHeight > availableHeight) {
      size -= 1;
      content.style.fontSize = `${size}px`;
    }
    fontSize.value = size;

    if (shouldManageHeight) {
      content.style.height = `${Math.min(content.scrollHeight, availableHeight)}px`;
    }
  }

  // contentEl — тоже источник: при переключении edit/view меняется САМ элемент
  // (textarea <-> span), а текст в моменте переключения ещё не изменился —
  // без этого источника новый элемент остался бы без применённого fontSize
  watch([text, width, height, contentEl, maxFontSize], recompute, { immediate: true });

  return fontSize;
}
