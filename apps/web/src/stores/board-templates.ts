import type { BoardTemplate } from '@poker/shared';
import { defineStore } from 'pinia';
import { ref } from 'vue';

import { api } from '../lib/api';

export const useBoardTemplatesStore = defineStore('board-templates', () => {
  const templates = ref<BoardTemplate[]>([]);
  const loaded = ref(false);

  async function load(): Promise<void> {
    if (loaded.value) return;
    const res = await api.get<{ templates: BoardTemplate[] }>('/api/board-templates');
    templates.value = res.templates;
    loaded.value = true;
  }

  function find(id: string): BoardTemplate | undefined {
    return templates.value.find((t) => t.id === id);
  }

  return { templates, loaded, load, find };
});
