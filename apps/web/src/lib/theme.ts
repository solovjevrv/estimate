/** Тема оформления: светлая/тёмная, применяется классом `.dark` на `<html>`. */
import { ref, watch } from 'vue';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'poker:theme';

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Без сохранённого выбора один раз смотрим на системную тему — дальше её не отслеживаем */
function readStoredTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isThemeMode(saved)) return saved;
  } catch {
    // Хранилище может быть недоступно — тогда используем системную тему
  }
  return prefersDark() ? 'dark' : 'light';
}

function rememberTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Выбор не сохранится, на текущую сессию это не влияет
  }
}

export const theme = ref<ThemeMode>(readStoredTheme());

function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle('dark', mode === 'dark');
}

export function toggleTheme(): void {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
}

/**
 * Инициализация подписки на смену темы — вызывается один раз из App.vue.
 * Применение при загрузке уже сделано инлайн-скриптом в index.html,
 * чтобы избежать мигания неверной темой до маунта приложения.
 */
export function initTheme(): void {
  applyTheme(theme.value);

  watch(theme, (mode) => {
    rememberTheme(mode);
    applyTheme(mode);
  });
}
