/** Тема оформления: светлая/тёмная/системная, применяется классом `.dark` на `<html>`. */
import { ref, watch } from 'vue';

export const THEME_MODES = ['system', 'light', 'dark'] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

const STORAGE_KEY = 'poker:theme';

function isThemeMode(value: string | null): value is ThemeMode {
  return value !== null && (THEME_MODES as readonly string[]).includes(value);
}

function readStoredTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isThemeMode(saved)) return saved;
  } catch {
    // Хранилище может быть недоступно — тогда работаем на системной теме
  }
  return 'system';
}

function rememberTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Выбор не сохранится, на текущую сессию это не влияет
  }
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function isDark(mode: ThemeMode): boolean {
  return mode === 'dark' || (mode === 'system' && prefersDark());
}

export const theme = ref<ThemeMode>(readStoredTheme());

function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle('dark', isDark(mode));
}

/**
 * Инициализация подписки на смену темы и на системный признак — вызывается один раз
 * из App.vue. Применение при загрузке уже сделано инлайн-скриптом в index.html,
 * чтобы избежать мигания неверной темой до маунта приложения.
 */
export function initTheme(): void {
  applyTheme(theme.value);

  watch(theme, (mode) => {
    rememberTheme(mode);
    applyTheme(mode);
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (theme.value === 'system') applyTheme('system');
  });
}
