/**
 * Постраничный срез уже загруженного списка — без похода на сервер.
 * Подходит, пока объём (комнаты пользователя/команды) остаётся в пределах
 * разумного (десятки, не тысячи); при реальном росте до сотен/тысяч комнат
 * стоит переходить на серверную пагинацию (limit/offset в API).
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';

export interface PagedList<T> {
  page: Ref<number>;
  pageSize: number;
  total: ComputedRef<number>;
  items: ComputedRef<T[]>;
  /** Вернуться на первую страницу — вызывать при смене контекста (команда, первая загрузка архива) */
  reset: () => void;
}

export function usePagedList<T>(source: ComputedRef<T[]>, pageSize = 10): PagedList<T> {
  const page = ref(1);
  const total = computed(() => source.value.length);
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

  // Список мог сократиться (удаление комнаты) — не оставляем страницу «за краем»
  watch(totalPages, (max) => {
    if (page.value > max) page.value = max;
  });

  const items = computed(() => {
    const start = (page.value - 1) * pageSize;
    return source.value.slice(start, start + pageSize);
  });

  function reset(): void {
    page.value = 1;
  }

  return { page, pageSize, total, items, reset };
}
