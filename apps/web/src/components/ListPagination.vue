<script setup lang="ts">
import type { PagedList } from '../composables/use-paged-list';

/**
 * Строка пагинации под списком (Pagination row в макетах 05/06/08) — одна на все
 * списки: верхняя граница, паддинг 16, Pagination по центру. Скрыта, пока всё
 * помещается на одну страницу.
 */
const props = defineProps<{ paging: PagedList<unknown> }>();
</script>

<template>
  <div
    v-if="props.paging.total.value > props.paging.pageSize"
    class="border-default flex justify-center border-t px-4 py-4 sm:px-8"
  >
    <!-- eslint-disable vue/no-mutating-props -- `page` — общая Ref-ячейка
         composable'а usePagedList, а не сам объект prop-а -->
    <UPagination
      v-model:page="props.paging.page.value"
      :total="props.paging.total.value"
      :items-per-page="props.paging.pageSize"
    />
    <!-- eslint-enable vue/no-mutating-props -->
  </div>
</template>
