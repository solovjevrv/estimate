/**
 * Значение поля `EntityTextModal` при смене `open` (18.8). При ЗАКРЫТИИ поле
 * специально не обнуляется: раньше `state.value` сбрасывалось в `''` сразу
 * на close, пока модалка ещё видима во время анимации исчезновения — UForm
 * валидирует на blur (закрытие снимает фокус с поля) и успевал показать
 * «поле не заполнено» на угасающей модалке. Оставлять старое значение до
 * следующего открытия безопасно — оно всё равно будет перезаписано свежим
 * `initialValue` раньше, чем модалка снова станет видимой.
 */
export function nextEntityModalValue(
  isOpen: boolean,
  initialValue: string,
  current: string,
): string {
  return isOpen ? initialValue : current;
}
