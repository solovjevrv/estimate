import type { BoardTemplate } from '@poker/shared';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBoardTemplatesStore } from '../../src/stores/board-templates';

const mockTemplates: BoardTemplate[] = [
  {
    id: '9f3a1b2c-c111-4a11-8b11-000000000001',
    scope: 'builtin',
    ownerId: null,
    teamId: null,
    name: 'Ретро: Start / Stop / Continue',
    nameKey: 'board.templates.retroStartStopContinue.name',
    description: 'Что начать, прекратить и продолжать делать',
    descriptionKey: 'board.templates.retroStartStopContinue.description',
    items: [
      {
        key: 'start-frame',
        parentKey: null,
        content: { type: 'frame', title: 'Start' },
        x: 0,
        y: 0,
        width: 380,
        height: 480,
        color: '#B6E565',
        zIndex: 0,
      },
    ],
    createdAt: '2026-08-13T00:00:00.000Z',
  },
];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('стор шаблонов досок', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('load() заполняет шаблоны и ставит loaded=true', async () => {
    fetchMock.mockResolvedValue(json(200, { templates: mockTemplates }));

    const store = useBoardTemplatesStore();
    await store.load();

    expect(store.templates).toHaveLength(1);
    expect(store.templates[0]?.name).toBe('Ретро: Start / Stop / Continue');
    expect(store.loaded).toBe(true);
  });

  it('load() не дублирует запрос при повторном вызове (loaded guard)', async () => {
    fetchMock.mockResolvedValue(json(200, { templates: mockTemplates }));

    const store = useBoardTemplatesStore();
    await store.load();
    await store.load();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('find() возвращает шаблон по id', async () => {
    fetchMock.mockResolvedValue(json(200, { templates: mockTemplates }));

    const store = useBoardTemplatesStore();
    await store.load();

    expect(store.find(mockTemplates[0]!.id)).toBeDefined();
    expect(store.find('nonexistent')).toBeUndefined();
  });
});
