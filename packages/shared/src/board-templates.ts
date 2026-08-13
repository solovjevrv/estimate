import type { BoardColorHex } from './index';

export type BoardTemplateScope = 'builtin' | 'personal' | 'team';

export type BoardTemplateItemContent =
  | { type: 'frame'; title: string }
  | { type: 'sticky'; text: string };

export interface BoardTemplateItem {
  /** Локальный ключ шаблона, не id доски — связывает parentKey → key при построении ops */
  key: string;
  parentKey: string | null;
  content: BoardTemplateItemContent;
  x: number;
  y: number;
  width: number;
  height: number;
  color: BoardColorHex;
  zIndex: number;
}

export interface BoardTemplate {
  id: string;
  scope: BoardTemplateScope;
  ownerId: string | null;
  teamId: string | null;
  name: string;
  nameKey: string | null;
  description: string | null;
  descriptionKey: string | null;
  items: BoardTemplateItem[];
  createdAt: string;
}
