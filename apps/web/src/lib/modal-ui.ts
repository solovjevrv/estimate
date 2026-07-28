/**
 * Токены модального окна из `.design/main.html` (создание команды — единственный
 * пример в макете): оверлей чёрный 40%, карточка 420px на `--brand-surface` с
 * тенью/радиусом `.surface-card` (radiusMd, 24px), без стандартных для Nuxt UI
 * колец/разделителей между header/body/footer.
 */
export const MODAL_UI = {
  overlay: 'bg-black/40',
  content:
    'max-w-[420px] rounded-[1.5rem] shadow-[var(--brand-shadow-card)] ring-0 divide-y-0 bg-[var(--brand-surface)]',
  header: 'p-7 pb-0',
  body: 'p-7 pt-4',
  footer: 'p-7 pt-4',
  title: 'font-heading text-[19px] font-extrabold',
  description: 'mt-2 text-[14.5px]',
};

/** Кнопки модалок из макета: радиус 10px, паддинг 11/18, 14px/700 — крупнее дефолта Nuxt UI */
export const MODAL_BUTTON_UI = { base: 'rounded-[10px] px-[18px] py-[11px] text-[14px] font-bold' };
