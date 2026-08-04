import { describe, expect, it } from 'vitest';
import { computed, nextTick, ref } from 'vue';

import { usePagedList } from '../src/composables/use-paged-list';

describe('usePagedList', () => {
  it('короткий список умещается на одной странице целиком', () => {
    const source = ref([1, 2, 3]);
    const paging = usePagedList(computed(() => source.value));

    expect(paging.total.value).toBe(3);
    expect(paging.items.value).toEqual([1, 2, 3]);
    expect(paging.page.value).toBe(1);
  });

  it('режет список по pageSize и листает вперёд', () => {
    const source = ref(Array.from({ length: 25 }, (_, i) => i));
    const paging = usePagedList(
      computed(() => source.value),
      10,
    );

    expect(paging.items.value).toEqual(Array.from({ length: 10 }, (_, i) => i));

    paging.page.value = 3;
    expect(paging.items.value).toEqual([20, 21, 22, 23, 24]);
  });

  it('при сокращении списка не оставляет страницу «за краем»', async () => {
    const source = ref(Array.from({ length: 25 }, (_, i) => i));
    const paging = usePagedList(
      computed(() => source.value),
      10,
    );
    paging.page.value = 3;

    source.value = source.value.slice(0, 5);
    await nextTick();

    expect(paging.page.value).toBe(1);
    expect(paging.items.value).toEqual([0, 1, 2, 3, 4]);
  });

  it('reset() возвращает на первую страницу', () => {
    const source = ref(Array.from({ length: 25 }, (_, i) => i));
    const paging = usePagedList(
      computed(() => source.value),
      10,
    );
    paging.page.value = 2;

    paging.reset();

    expect(paging.page.value).toBe(1);
  });
});
