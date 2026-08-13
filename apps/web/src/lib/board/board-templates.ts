import type { BoardItemCreateOp, BoardTemplate } from '@poker/shared';

import { uuid } from './uuid';

export function buildTemplateOps(template: BoardTemplate): BoardItemCreateOp[] {
  const idByKey = new Map<string, string>();
  for (const item of template.items) {
    idByKey.set(item.key, uuid());
  }

  return template.items.map((item) => ({
    type: 'item.create' as const,
    clientOpId: uuid(),
    item: {
      id: idByKey.get(item.key)!,
      parentId: item.parentKey !== null ? (idByKey.get(item.parentKey) ?? null) : null,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      rotation: 0,
      zIndex: item.zIndex,
      content: item.content,
      style: { color: item.color },
      reactions: [],
    },
  }));
}
