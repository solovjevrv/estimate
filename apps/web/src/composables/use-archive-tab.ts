import { reactive, ref } from 'vue';

export interface ArchiveTab {
  /** Для раскрывающегося архива на личных страницах. */
  readonly open: boolean;
  readonly loading: boolean;
  readonly failed: boolean;
  /** Загружает архив ровно один раз до reset(), повторяет запрос после ошибки. */
  activate: () => Promise<void>;
  /** Переключает раскрывающийся архив и при открытии запускает activate(). */
  toggle: () => Promise<void>;
  /** Сбрасывает кэш при смене родительской сущности (например, команды). */
  reset: () => void;
}

/**
 * Общая lazy-загрузка архива. Данные остаются в доменном store или на странице,
 * а composable хранит только UI-состояние и защищает от параллельных запросов.
 */
export function useArchiveTab(load: () => Promise<void>, afterLoad?: () => void): ArchiveTab {
  const open = ref(false);
  const loading = ref(false);
  const failed = ref(false);
  let loaded = false;
  let generation = 0;

  async function activate(): Promise<void> {
    if (loaded || loading.value) return;

    const requestGeneration = generation;
    loading.value = true;
    failed.value = false;
    try {
      await load();
      if (requestGeneration !== generation) return;
      loaded = true;
      afterLoad?.();
    } catch {
      if (requestGeneration === generation) failed.value = true;
    } finally {
      if (requestGeneration === generation) loading.value = false;
    }
  }

  async function toggle(): Promise<void> {
    open.value = !open.value;
    if (open.value) await activate();
  }

  function reset(): void {
    generation += 1;
    open.value = false;
    loading.value = false;
    failed.value = false;
    loaded = false;
  }

  return reactive({ open, loading, failed, activate, toggle, reset });
}
