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
 * Базовый размер (12.9) параметризуем: ручной выбор в панели свойств
 * (`BoardItemStyle.fontSize`) относится к дефолтной геометрии элемента и при
 * resize масштабируется вместе с ней. Это не отключает сам подбор: если
 * текста больше, чем помещается даже при вычисленном размере, авто-fit всё
 * равно ужимает шрифт вплоть до `FIT_FONT_MIN` — решение пользователя
 * 07.08.2026 (не возвращать риск переполнения/скролла, который уже чинили в
 * 12.8).
 *
 * Цикл подгонки исходно сравнивал только ВЫСОТУ (`scrollHeight` vs доступное
 * место) — ширина отдельных слов не проверялась: `overflow-wrap: break-word`
 * молча переносит слово по буквам, если оно не влезает в бокс по ширине, а
 * лишняя строка от такого переноса могла легко уместиться по высоте (места
 * много), и цикл на этом останавливался, не считая это переполнением. Пока
 * базовый размер был жёстко ограничен потолком ~20px, слово редко оказывалось
 * шире бокса; после 18.5 (масштабирование шрифта вместе с боксом без потолка)
 * это стало заметно чаще на больших объектах. С 18.5 цикл дополнительно
 * ужимает шрифт, если самое длинное слово текста (по измерению через Canvas
 * `measureText`) шире доступной ширины контента — до тех пор, пока слово не
 * поместится целиком или размер не упрётся в `FIT_FONT_MIN` (при
 * `FIT_FONT_MIN`, если слово всё равно не влезает, перенос по буквам —
 * неизбежный, ожидаемый fallback, а не баг).
 */
import { nextTick, ref, watch, type Ref } from 'vue';

import type { BoardFontSizeMode } from '@poker/shared';

export const FIT_FONT_MIN = 10;
/** Базовый размер текста для геометрии элемента по умолчанию. */
export const FIT_FONT_MAX = 20;

/**
 * Размер, с которого начинается авто-fit. `baseFontSize` относится к дефолтной
 * геометрии элемента, поэтому при resize короткий текст растёт и уменьшается
 * вместе с боксом. Для непропорционального бокса берём меньшую сторону, чтобы
 * текст не начал переполнять узкую ось.
 */
export function getScaledFontSize(
  baseFontSize: number,
  width: number,
  height: number,
  defaultWidth: number,
  defaultHeight: number,
): number {
  const scale = Math.min(width / defaultWidth, height / defaultHeight);
  return Math.max(FIT_FONT_MIN, Math.round(baseFontSize * scale));
}

/**
 * Обратная операция к `getScaledFontSize` — тулбар шагает по ОТОБРАЖАЕМОМУ
 * (масштабированному) размеру шрифта, но сохраняется базовый. При `scale` >
 * шага стэппера `Math.round(targetFontSize / scale)` откатывается обратно к
 * `currentBase` (шаг в 2px displayed — меньше 1px base) — клик по +/- молча
 * ничего не менял бы, и оставался бы «залипшим», раз при следующем клике
 * currentBase/displayed те же самые. Гарантируем минимум ±1 к базе в сторону
 * клика, если точный пересчёт откатился к текущему значению.
 */
export function unscaleFontSizeStep(
  currentBase: number,
  targetFontSize: number,
  scale: number,
): number {
  const rounded = Math.round(targetFontSize / scale);
  if (rounded !== currentBase) return rounded;
  return currentBase + Math.sign(targetFontSize - currentBase * scale);
}

/** Ширина самого длинного «слова» (по whitespace) — чистая функция, `measureWidth` внедряется для тестируемости без реального Canvas. */
export function longestWordWidth(text: string, measureWidth: (word: string) => number): number {
  let max = 0;
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const width = measureWidth(word);
    if (width > max) max = width;
  }
  return max;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Единственный на всё приложение офскрин-canvas для measureText — дешёвый переиспользуемый измеритель. */
function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

export function useFitFontSize(
  containerEl: Ref<HTMLElement | null>,
  contentEl: Ref<HTMLElement | null>,
  text: Ref<string>,
  width: Ref<number>,
  height: Ref<number>,
  /** true только для textarea в момент редактирования — у span (просмотр) высотой не управляем */
  manageHeight: Ref<boolean>,
  /** Базовый размер для дефолтной геометрии, не потолок итогового размера. */
  baseFontSize: Ref<number> = ref(FIT_FONT_MAX),
  defaultWidth: number,
  defaultHeight: number,
  /**
   * `auto` (по умолчанию) — базовый размер масштабируется вместе с боксом
   * (текущее поведение). `manual` (26.08.2026, решение пользователя, по
   * референсу Miro) — пользователь явно задал конкретное число, resize бокса
   * его не трогает: старт всегда с `baseFontSize` как есть, без масштабирования.
   * Авто-сжатие при переполнении ниже работает одинаково в обоих режимах —
   * это защита от обрезки длинным текстом, не масштабирование под геометрию.
   */
  mode: Ref<BoardFontSizeMode> = ref('auto'),
): Ref<number> {
  const fontSize = ref(baseFontSize.value);

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
    const availableWidth =
      container.clientWidth -
      parseFloat(containerStyle.paddingLeft) -
      parseFloat(containerStyle.paddingRight);

    const shouldManageHeight = manageHeight.value;
    if (shouldManageHeight) content.style.height = 'auto';

    let size =
      mode.value === 'manual'
        ? baseFontSize.value
        : getScaledFontSize(
            baseFontSize.value,
            width.value,
            height.value,
            defaultWidth,
            defaultHeight,
          );
    content.style.fontSize = `${size}px`;

    // Учитываем не только базовое начертание — жирный/курсив внутри отдельных
    // ranges форматирования измерению недоступны (contentStyle — стиль корня,
    // не вложенных <strong>/<em>), это приемлемое приближение под конкретный
    // репортнутый кейс (обычный текст).
    const contentStyle = getComputedStyle(content);
    const ctx = getMeasureContext();
    const wordTooWide = (fontSizePx: number): boolean => {
      if (!ctx || availableWidth <= 0) return false;
      ctx.font = `${contentStyle.fontStyle} ${contentStyle.fontWeight} ${fontSizePx}px ${contentStyle.fontFamily}`;
      return longestWordWidth(text.value, (word) => ctx.measureText(word).width) > availableWidth;
    };

    while (size > FIT_FONT_MIN && (content.scrollHeight > availableHeight || wordTooWide(size))) {
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
  watch([text, width, height, contentEl, baseFontSize, mode], recompute, { immediate: true });

  return fontSize;
}
