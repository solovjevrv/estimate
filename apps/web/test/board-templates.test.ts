import type { BoardTemplate, BoardTemplateItem } from '@poker/shared';
import { describe, expect, it } from 'vitest';

import { buildTemplateOps } from '../src/lib/board/board-templates';

const template: BoardTemplate = {
  id: '9f3a1b2c-c111-4a11-8b11-000000000001',
  scope: 'builtin',
  ownerId: null,
  teamId: null,
  name: 'Ретро: Start / Stop / Continue',
  nameKey: 'board.templates.retroStartStopContinue.name',
  description: 'Что начать, прекратить и продолжать делать',
  descriptionKey: 'board.templates.retroStartStopContinue.description',
  items: [
    { key: 'start-frame', parentKey: null, content: { type: 'frame', title: 'Start' }, x: 0, y: 0, width: 380, height: 480, color: '#B6E565', zIndex: 0 },
    { key: 'start-note', parentKey: 'start-frame', content: { type: 'sticky', text: 'Что стоит начать делать?' }, x: 100, y: 30, width: 180, height: 120, color: '#FCEB96', zIndex: 1 },
    { key: 'stop-frame', parentKey: null, content: { type: 'frame', title: 'Stop' }, x: 420, y: 0, width: 380, height: 480, color: '#FF9595', zIndex: 0 },
    { key: 'stop-note', parentKey: 'stop-frame', content: { type: 'sticky', text: 'Что стоит прекратить делать?' }, x: 520, y: 30, width: 180, height: 120, color: '#FCEB96', zIndex: 1 },
    { key: 'continue-frame', parentKey: null, content: { type: 'frame', title: 'Continue' }, x: 840, y: 0, width: 380, height: 480, color: '#7DA9F6', zIndex: 0 },
    { key: 'continue-note', parentKey: 'continue-frame', content: { type: 'sticky', text: 'Что стоит продолжать делать?' }, x: 940, y: 30, width: 180, height: 120, color: '#FCEB96', zIndex: 1 },
  ],
  createdAt: '2026-08-13T00:00:00.000Z',
};

describe('buildTemplateOps', () => {
  it('возвращает ops в том же порядке, что и элементы шаблона', () => {
    const ops = buildTemplateOps(template);

    expect(ops).toHaveLength(template.items.length);
  });

  it('каждая операция содержит уникальный id и clientOpId', () => {
    const ops = buildTemplateOps(template);
    const ids = ops.map((op) => op.item.id);
    const clientOpIds = ops.map((op) => op.clientOpId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(clientOpIds).size).toBe(clientOpIds.length);
  });

  it('фреймы идут раньше своих дочерних стикеров (тот же batch)', () => {
    const keys = template.items.map((i) => i.key);

    for (const item of template.items) {
      const itemIndex = keys.indexOf(item.key);
      if (item.parentKey !== null) {
        const parentIndex = keys.indexOf(item.parentKey);
        expect(parentIndex).toBeLessThan(itemIndex);
      }
    }
  });

  it('parentId стикера указывает на сгенерированный id фрейма, а не на template-key', () => {
    const ops = buildTemplateOps(template);
    const idByKey = new Map<string, string>();
    for (const item of template.items) {
      idByKey.set(item.key, '');
    }
    // Восстановим mapping ключ → сгенерированный id из ops
    const keyToGeneratedId = new Map<string, string>();
    for (let i = 0; i < template.items.length; i++) {
      keyToGeneratedId.set(template.items[i]!.key, ops[i]!.item.id);
    }

    for (let i = 0; i < template.items.length; i++) {
      const item: BoardTemplateItem = template.items[i]!;
      const op = ops[i]!;
      if (item.parentKey !== null) {
        expect(op.item.parentId).toBe(keyToGeneratedId.get(item.parentKey));
      } else {
        expect(op.item.parentId).toBeNull();
      }
    }
  });

  it('корректно переносит координаты, размеры, zIndex и цвет', () => {
    const ops = buildTemplateOps(template);

    for (let i = 0; i < template.items.length; i++) {
      const item = template.items[i]!;
      const op = ops[i]!;
      expect(op.item.x).toBe(item.x);
      expect(op.item.y).toBe(item.y);
      expect(op.item.width).toBe(item.width);
      expect(op.item.height).toBe(item.height);
      expect(op.item.zIndex).toBe(item.zIndex);
      expect(op.item.rotation).toBe(0);
      expect(op.item.style.color).toBe(item.color);
    }
  });

  it('content подставляется как есть из шаблона', () => {
    const ops = buildTemplateOps(template);

    for (let i = 0; i < template.items.length; i++) {
      const item = template.items[i]!;
      const op = ops[i]!;
      expect(op.item.content).toEqual(item.content);
    }
  });

  it('reactions всегда пустой массив', () => {
    const ops = buildTemplateOps(template);
    for (const op of ops) {
      expect(op.item.reactions).toEqual([]);
    }
  });

  it('все элементы имеют type item.create', () => {
    const ops = buildTemplateOps(template);
    for (const op of ops) {
      expect(op.type).toBe('item.create');
    }
  });
});
