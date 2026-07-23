import { createI18n } from 'vue-i18n';

import en from './locales/en';
import ru from './locales/ru';

export const LOCALES = ['ru', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ru';

/** Русский файл — эталон: по нему проверяются ключи в компонентах и в английском переводе */
export type MessageSchema = typeof ru;

/** Аннотация не косметическая: без неё пропущенный английский ключ всплыл бы только у пользователя */
const messages: Record<Locale, MessageSchema> = { ru, en };

const STORAGE_KEY = 'poker:locale';

function isLocale(value: string | null): value is Locale {
  return value !== null && (LOCALES as readonly string[]).includes(value);
}

/** Выбранный язык, иначе язык браузера, иначе русский */
export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // Хранилище может быть недоступно — тогда спросим браузер
  }
  // languages есть не везде (старые вебвью) — тогда откатываемся к language
  const languages = navigator.languages ?? [navigator.language ?? ''];
  const preferred = languages.map((lang) => lang.slice(0, 2));
  return preferred.find(isLocale) ?? DEFAULT_LOCALE;
}

export function rememberLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Выбор не сохранится, на текущую сессию это не влияет
  }
}

export function createAppI18n(locale: Locale = detectLocale()) {
  return createI18n<[MessageSchema], Locale, false>({
    // Composition API: доступ к переводам только через useI18n
    legacy: false,
    locale,
    fallbackLocale: DEFAULT_LOCALE,
    messages,
  });
}
