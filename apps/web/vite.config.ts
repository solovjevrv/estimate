/// <reference types="vitest/config" />
import ui from '@nuxt/ui/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// Figma (06_Input, Focus): рамка становится border-brand (зелёная), без
// внешнего свечения/кольца — у Nuxt UI дефолт для фокуса (color="primary",
// свой применяется по умолчанию, наш app.config цвет не переопределяет) —
// это focus-visible:outline-3 (полупрозрачный ореол шириной 3px) плюс
// focus-visible:ring-primary (--ui-primary — тот же не по месту применённый
// токен, что был в 20.12 у навигации: в тёмной теме темнее, чем наш
// border-brand). Тот же паттерн у Input/InputNumber/Select/Textarea — все
// используют один ring-based "outline" вариант из общей темы Nuxt UI.
const inputFocusFix = {
  color: 'primary',
  variant: 'outline',
  class: 'focus-visible:outline-none! focus-visible:ring-[var(--border-brand)]!',
};

// 20.3.5 (10_Profile): то же самое несовпадение токена, что было у focus выше —
// Error/Error Focus в Figma это просто рамка --border-error (--palette-error-120,
// тёмный тон), а Nuxt UI цвету color="error" красит ring через --ui-error
// (--palette-error-100, ярче) и добавляет тот же полупрозрачный ореол на фокусе.
// Раньше это не встречалось в коде (не было полей с color="error"), первый живой
// случай — обязательное имя в форме профиля.
const inputErrorFix = {
  color: 'error',
  variant: 'outline',
  class:
    'ring-[var(--border-error)]! focus-visible:outline-none! focus-visible:ring-[var(--border-error)]!',
};

// Цвета Button — по матрице Color × Style × State компонента в Figma (08_Button):
// каждое состояние на своём семантическом токене (Hover/Pressed — отдельные
// *-hover/*-pressed/*-low-hover, Disabled — surface-disabled + text-disabled
// вместо общей прозрачности Nuxt UI). Без `!`: twMerge распознаёт кастомные цвета
// (bg-surface-*, text-text-*) и сам выбрасывает конфликтующий дефолт Nuxt UI, а
// класс, переданный компоненту (например, слот item у Pagination), перебивает пресет.
// Subtle в ките нет — выравнен с Soft.
// Классы — только литералами: Tailwind находит их сканированием исходников.
const DIS_FILLED =
  'disabled:bg-surface-disabled aria-disabled:bg-surface-disabled disabled:text-text-disabled aria-disabled:text-text-disabled';
const DIS_CLEAR =
  'disabled:bg-transparent aria-disabled:bg-transparent disabled:text-text-disabled aria-disabled:text-text-disabled';
const DIS_RING =
  'disabled:ring-[var(--border-disabled)] aria-disabled:ring-[var(--border-disabled)]';
const buttonColors = [
  // Primary
  [
    'primary',
    'solid',
    'bg-surface-brand text-text-on-brand hover:bg-surface-brand-hover active:bg-surface-brand-pressed ' +
      DIS_FILLED,
  ],
  [
    'primary',
    'outline',
    'ring-[var(--border-brand)] bg-transparent text-text-brand hover:bg-surface-brand-low active:bg-surface-brand-low-hover ' +
      DIS_CLEAR +
      ' ' +
      DIS_RING,
  ],
  [
    'primary',
    'soft',
    'bg-surface-brand-low text-text-brand hover:bg-surface-brand-low-hover active:bg-surface-brand-low-pressed ' +
      DIS_FILLED,
  ],
  [
    'primary',
    'subtle',
    'ring-0 bg-surface-brand-low text-text-brand hover:bg-surface-brand-low-hover active:bg-surface-brand-low-pressed ' +
      DIS_FILLED,
  ],
  [
    'primary',
    'ghost',
    'bg-transparent text-text-brand hover:bg-surface-brand-low active:bg-surface-brand-low-hover ' +
      DIS_CLEAR,
  ],
  // Neutral
  [
    'neutral',
    'solid',
    'bg-surface-neutral text-text-white hover:bg-surface-neutral-hover active:bg-surface-neutral-pressed ' +
      DIS_FILLED,
  ],
  [
    'neutral',
    'outline',
    'ring-[var(--border-tertiary)] bg-transparent text-text-primary hover:bg-surface-hover active:bg-surface-tertiary ' +
      DIS_CLEAR +
      ' ' +
      DIS_RING,
  ],
  [
    'neutral',
    'soft',
    'bg-surface-tertiary text-text-primary hover:bg-surface-neutral-low-hover active:bg-surface-neutral-low-pressed ' +
      DIS_FILLED,
  ],
  [
    'neutral',
    'subtle',
    'ring-0 bg-surface-tertiary text-text-primary hover:bg-surface-neutral-low-hover active:bg-surface-neutral-low-pressed ' +
      DIS_FILLED,
  ],
  [
    'neutral',
    'ghost',
    'bg-transparent text-text-primary hover:bg-surface-hover active:bg-surface-tertiary ' +
      DIS_CLEAR,
  ],
  // Error
  [
    'error',
    'solid',
    'bg-surface-error text-text-white hover:bg-surface-error-hover active:bg-surface-error-pressed ' +
      DIS_FILLED,
  ],
  [
    'error',
    'outline',
    'ring-[var(--border-error)] bg-transparent text-text-error hover:bg-surface-error-low active:bg-surface-error-low-hover ' +
      DIS_CLEAR +
      ' ' +
      DIS_RING,
  ],
  [
    'error',
    'soft',
    'bg-surface-error-low text-text-error hover:bg-surface-error-low-hover active:bg-surface-error-low-pressed ' +
      DIS_FILLED,
  ],
  [
    'error',
    'subtle',
    'ring-0 bg-surface-error-low text-text-error hover:bg-surface-error-low-hover active:bg-surface-error-low-pressed ' +
      DIS_FILLED,
  ],
  [
    'error',
    'ghost',
    'bg-transparent text-text-error hover:bg-surface-error-low active:bg-surface-error-low-hover ' +
      DIS_CLEAR,
  ],
] as const;

// Состояния поля по 06_Input/07_Select/10_Textarea: Default — border-strong (это
// ring-accented Nuxt UI), Hover — border-secondary, Disabled — surface-disabled +
// border-tertiary + text-disabled без общей прозрачности Nuxt UI. Focus/Error —
// inputFocusFix/inputErrorFix выше (с `!`, поэтому перебивают и hover).
const fieldOutline =
  'text-text-primary bg-surface-frame ring ring-inset ring-accented hover:ring-[var(--border-secondary)] disabled:opacity-100 disabled:bg-surface-disabled disabled:ring-[var(--border-tertiary)] disabled:text-text-disabled';

export default defineConfig({
  plugins: [
    vue(),
    // Плагин сам поднимает автоимпорт компонентов и генерирует
    // auto-imports.d.ts и components.d.ts — оба файла в git не хранятся.
    // Размеры Button/Input/Select/Textarea/Modal — по факту компонентов
    // Estimate UI Kit в Figma (08_Button, 06_Input, 07_Select, 10_Textarea,
    // 27_Modal), не по формулам: радиусы 8/10/12 — токены --radius-r* из
    // assets/tokens.css (20.1), а не глобальный множитель --ui-radius
    // (тот продолжает отвечать за rounded-*, применяемые вне этих компонентов).
    ui({
      ui: {
        button: {
          // Nuxt UI сам не ставит cursor-pointer на активную (не disabled) кнопку —
          // только disabled:cursor-not-allowed. Без этого все UButton показывают
          // обычный курсор вместо pointer при наведении
          // disabled:opacity-100 — у Nuxt UI disabled гасит кнопку прозрачностью, в ките
          // у Disabled свои токены (DIS_* выше)
          slots: {
            base: 'font-bold cursor-pointer disabled:opacity-100 aria-disabled:opacity-100',
          },
          variants: {
            size: {
              sm: { base: 'px-2.5 py-2 text-xs gap-1.5 rounded-r8' },
              md: { base: 'px-3 py-2.5 text-sm gap-2 rounded-r10' },
              lg: { base: 'px-4 py-3 text-base gap-2 rounded-r12' },
            },
          },
          compoundVariants: buttonColors.map(([color, variant, cls]) => ({
            color,
            variant,
            class: cls,
          })),
        },
        // Высоты — по факту Container (counterAxisSizingMode: FIXED) компонента
        // Input в Figma: 34/40/48, не по формуле padding+line-height (не сходится
        // на пару px, отсюда h-* явно, а не расчёт через py-*). Md/Lg — 40/48,
        // совпадает с кнопками той же ступени. Шрифт Md/Lg — 16px (text-base),
        // не text-sm, как ошибочно было при первом промере в 20.2. `md:text-base!`
        // не опечатка: у Nuxt UI в собственной теме Input зашит `md:text-sm`
        // (брейкпоинт вьюпорта, а не наш размер компонента); twMerge внутри их
        // tv()-конфига сохраняет именно их класс при конфликте в одной и той же
        // группе брейкпоинта, обычный `md:text-base` тут молча проигрывает —
        // побеждает только через `!important` (суффикс `!`).
        input: {
          variants: {
            size: {
              sm: { base: 'h-[34px] px-2.5 text-xs gap-1.5 rounded-r8' },
              md: { base: 'h-10 px-2.5 text-base md:text-base! gap-1.5 rounded-r10' },
              lg: { base: 'h-12 px-3 text-base md:text-base! gap-2 rounded-r12' },
            },
            variant: { outline: fieldOutline },
          },
          compoundVariants: [inputFocusFix, inputErrorFix],
        },
        // Тот же паттерн, что Input — тач ин-плейс редактор шага (BoardExportModal
        // и др.), в Figma отдельно не описан
        inputNumber: {
          variants: {
            size: {
              sm: { base: 'h-[34px] px-2.5 text-xs gap-1.5 rounded-r8' },
              md: { base: 'h-10 px-2.5 text-base md:text-base! gap-1.5 rounded-r10' },
              lg: { base: 'h-12 px-3 text-base md:text-base! gap-2 rounded-r12' },
            },
            variant: { outline: fieldOutline },
          },
          compoundVariants: [inputFocusFix, inputErrorFix],
        },
        // Select Item (07_Select): 40px, паддинг 12×10, r10, Body/Large/Medium;
        // Highlighted — surface-tertiary, Selected — text-brand + галочка,
        // Disabled — text-disabled без прозрачности
        select: {
          slots: {
            item: 'items-center font-medium data-highlighted:not-data-disabled:before:bg-surface-tertiary data-[state=checked]:text-text-brand data-disabled:opacity-100 data-disabled:text-text-disabled',
            itemTrailingIcon: 'text-icons-brand',
          },
          variants: {
            size: {
              sm: { base: 'h-[34px] px-2.5 text-xs gap-1.5 rounded-r8' },
              md: {
                base: 'h-10 px-2.5 text-base gap-1.5 rounded-r10',
                item: 'px-3 py-2.5 text-base gap-1.5 before:rounded-r10',
                itemTrailingIcon: 'size-4',
              },
              lg: { base: 'h-12 px-3 text-base gap-2 rounded-r12' },
            },
            variant: { outline: fieldOutline },
          },
          compoundVariants: [inputFocusFix, inputErrorFix],
        },
        textarea: {
          variants: {
            size: {
              sm: { base: 'px-2.5 py-1.5 text-xs gap-1.5 rounded-r8' },
              md: { base: 'px-2.5 py-2 text-base gap-1.5 rounded-r10' },
              lg: { base: 'px-3 py-3 text-base gap-2 rounded-r12' },
            },
            variant: { outline: fieldOutline },
          },
          compoundVariants: [inputFocusFix, inputErrorFix],
        },
        // 18_Avatar: fallback — surface-brand, инициалы Manrope Bold. Цвет инициалов
        // наследуется от root (currentColor): цвет-пара фон+текст задаётся одним классом
        // teamAvatarColor (lib/team-roles.ts)
        avatar: {
          slots: {
            root: 'bg-surface-brand text-icons-on-brand',
            fallback: 'font-bold text-current',
          },
        },
        // 31_Skeleton: цвет всегда surface-skeleton, радиус задаётся по месту (r8/r12/r24/full)
        skeleton: {
          base: 'bg-surface-skeleton',
        },
        // 32_Empty: карточка 48×32, все элементы через 16px, заголовок Body/Xlarge/Bold,
        // описание Body/Medium/Medium text-secondary шириной до 340px
        empty: {
          slots: {
            root: 'gap-4 px-8 py-12 sm:px-8 sm:py-12 lg:px-8 lg:py-12',
            header: 'gap-4 max-w-[340px]',
            title: 'text-lg leading-[26px] font-bold text-text-primary',
            description: 'text-sm font-medium text-text-secondary',
          },
        },
        // Подпись поля — Body/Medium/Bold text-primary, отступ до поля 6px (06_Input)
        formField: {
          slots: {
            label: 'text-sm font-bold text-text-primary',
            container: 'mt-1.5',
            description: 'text-text-tertiary',
            hint: 'text-text-tertiary',
            error: 'text-text-error',
          },
        },
        // 14_Switch: трек surface-tertiary/surface-brand, бегунок icons-white в обеих
        // темах (у Nuxt UI — bg-default, в Dark тёмный), Disabled — прозрачность 45%
        switch: {
          slots: {
            base: 'disabled:opacity-45',
            thumb: 'bg-icons-white',
          },
        },
        // 29_Alert: единственный стиль — subtle, Error/Warning на *-low подложке без
        // обводки, текст Body/Medium/Medium своего цвета, паддинг 20×16, r12
        alert: {
          slots: {
            root: 'rounded-r12 px-5 py-4 gap-3',
            title: 'font-bold',
            description: 'font-medium opacity-100',
          },
          compoundVariants: [
            {
              color: 'error',
              variant: 'subtle',
              class: { root: 'bg-surface-error-low text-text-error ring-0' },
            },
            {
              color: 'warning',
              variant: 'subtle',
              class: { root: 'bg-surface-warning-low text-text-warning ring-0' },
            },
          ],
        },
        // 34_Pagination: пункты 36×36 r10 Body/Small/Bold, без обводки; Hover —
        // surface-tertiary, текущая страница — surface-brand (activeVariant solid)
        pagination: {
          slots: {
            first:
              'size-9 justify-center p-0 rounded-r10 ring-0 bg-transparent hover:bg-surface-tertiary',
            prev: 'size-9 justify-center p-0 rounded-r10 ring-0 bg-transparent hover:bg-surface-tertiary',
            next: 'size-9 justify-center p-0 rounded-r10 ring-0 bg-transparent hover:bg-surface-tertiary',
            last: 'size-9 justify-center p-0 rounded-r10 ring-0 bg-transparent hover:bg-surface-tertiary',
            item: 'size-9 justify-center p-0 rounded-r10 text-xs text-text-secondary ring-0 bg-transparent hover:bg-surface-tertiary aria-[current=page]:bg-surface-brand aria-[current=page]:text-text-on-brand aria-[current=page]:hover:bg-surface-brand-hover',
            ellipsis: 'size-9 justify-center p-0 text-text-secondary',
          },
        },
        modal: {
          slots: {
            content:
              'w-[calc(100%-2rem)] max-w-[420px] rounded-r24 shadow-elevation-4 ring-0 divide-y-0 bg-[var(--brand-surface)]',
            // Строка заголовка 32px (по кнопке закрытия), у Nuxt UI — min-h 64px;
            // крестик — в этой строке у правого края (отступ 24), а не в углу на 16
            header: 'p-6 pb-0 min-h-0',
            close: 'top-6 end-6',
            body: 'p-6 pt-4',
            footer: 'p-6 pt-4 justify-end gap-2.5',
            // Title row 32px (по кнопке закрытия), до описания 12px — 27_Modal
            title: 'font-heading text-xl leading-8 font-bold text-text-primary',
            description: 'mt-3 text-sm font-medium text-text-secondary',
          },
          // surface-overlay: black/40 в Light, black/60 в Dark. Цвет у Nuxt UI задан в
          // варианте overlay=true (bg-elevated/75), а не в слоте — там его и перебиваем
          variants: {
            overlay: { true: { overlay: 'bg-surface-overlay' } },
          },
        },
        // По факту компонента DropdownMenu в Kit (35_DropdownMenu) — раньше не
        // было пресета вовсе, меню жило на чистых дефолтах Nuxt UI (нашёл
        // пользователь по свежесобранному меню участника, 20.3.3). Контейнер
        // r12/elevation-5/паддинг 6, пункт 36px/r8/паддинг 12×9/шрифт 12 Medium
        // (не Bold), иконка 16px. Цвет hover пункта — bg-elevated Nuxt UI, это токен
        // surface-hover (--ui-bg-elevated в main.css). items-center и before:rounded-r8
        // — свои дефолты Nuxt UI (items-start, before:rounded-md) не сверены с
        // китом: из-за items-start пункт с доп. контентом в trailing-слоте
        // (переключатель темы) не центрируется по вертикали относительно лейбла.
        dropdownMenu: {
          slots: {
            content: 'rounded-r12 shadow-elevation-5 ring-0 bg-[var(--brand-surface)]',
            group: 'p-1.5 flex flex-col gap-0.5',
            // Разделитель — на всю ширину меню, border-medium (Divider в ките)
            separator: 'mx-0 my-px bg-border-medium',
            item: 'text-text-primary data-disabled:opacity-100 data-disabled:text-text-disabled',
            itemLeadingIcon: 'text-icons-primary group-data-disabled:text-icons-disabled',
          },
          // MenuItem Tone=Danger: text-error, Hover — surface-danger-hover (не error/10)
          compoundVariants: [
            {
              color: 'error',
              class: {
                item: 'text-text-error data-highlighted:text-text-error data-highlighted:before:bg-surface-danger-hover data-[state=open]:before:bg-surface-danger-hover',
                itemLeadingIcon: 'text-icons-error group-data-highlighted:text-icons-error',
              },
            },
          ],
          variants: {
            size: {
              md: {
                item: 'items-center rounded-r8 px-3 py-2.5 text-xs font-medium gap-2.5 before:rounded-r8',
                itemLeadingIcon: 'size-4',
                itemTrailingIcon: 'size-4',
              },
            },
          },
        },
      },
    }),
  ],
  define: {
    // Флаги сборки vue-i18n: работаем только через Composition API,
    // поэтому поддержка Options API и панель разработчика в бандл не нужны
    __VUE_I18N_FULL_INSTALL__: 'false',
    __VUE_I18N_LEGACY_API__: 'false',
    __INTLIFY_PROD_DEVTOOLS__: 'false',
    // Короткий git-хэш сборки для футера (CD прокидывает через APP_VERSION,
    // см. Dockerfile/docker-compose.prod.yml); локально — просто 'dev'
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? 'dev'),
  },
  server: {
    port: 5173,
    // Дев-фронт ходит теми же путями, что прод через nginx
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // Сценарии Playwright запускает свой раннер
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});
