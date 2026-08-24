/**
 * Контракт каталога emoji (21.4). Сами данные (EMOJI_CATALOG) — в
 * ./catalog.generated (генерируется скриптом из emojibase-data) и НЕ
 * реэкспортируются отсюда: файл с данными большой (весь Unicode-набор с
 * тегами на двух языках), и его нельзя тянуть в основной бандл фронта.
 * Импортировать данные — только через отдельный подпуть пакета
 * '@poker/shared/emoji/catalog' (см. package.json 'exports'), что даёт
 * фронту возможность подключать его через динамический import().
 */

/** Строка-последовательность эмодзи (обычный Unicode, включая ZWJ/тон кожи) */
export type EmojiSequence = string;

export type EmojiGroupId =
  | 'smileys-emotion'
  | 'people-body'
  | 'animals-nature'
  | 'food-drink'
  | 'travel-places'
  | 'activities'
  | 'objects'
  | 'symbols'
  | 'flags';

export type SkinToneId = 'light' | 'medium-light' | 'medium' | 'medium-dark' | 'dark';

export interface EmojiGroupMeta {
  id: EmojiGroupId;
  labelEn: string;
  labelRu: string;
}

/** Порядок — как в референсных emoji-пикерах (смайлы первыми, флаги последними) */
export const EMOJI_GROUPS: readonly EmojiGroupMeta[] = [
  { id: 'smileys-emotion', labelEn: 'Smileys & Emotion', labelRu: 'Смайлы и эмоции' },
  { id: 'people-body', labelEn: 'People & Body', labelRu: 'Люди и жесты' },
  { id: 'animals-nature', labelEn: 'Animals & Nature', labelRu: 'Животные и природа' },
  { id: 'food-drink', labelEn: 'Food & Drink', labelRu: 'Еда и напитки' },
  { id: 'travel-places', labelEn: 'Travel & Places', labelRu: 'Путешествия и места' },
  { id: 'activities', labelEn: 'Activities', labelRu: 'Активности' },
  { id: 'objects', labelEn: 'Objects', labelRu: 'Предметы' },
  { id: 'symbols', labelEn: 'Symbols', labelRu: 'Символы' },
  { id: 'flags', labelEn: 'Flags', labelRu: 'Флаги' },
] as const;

export interface EmojiCatalogEntry {
  /** Базовый (без выбранного тона кожи) Unicode-глиф */
  unicode: EmojiSequence;
  group: EmojiGroupId;
  /** Порядок внутри группы — как в исходном датасете, для стабильной сетки */
  order: number;
  label: string;
  tagsEn: string[];
  tagsRu: string[];
  /** Без ':' по краям, напр. 'fire', 'thumbsup' */
  shortcodes: string[];
  /** Есть только у entry, поддерживающих модификатор тона кожи (Fitzpatrick) */
  skins?: Partial<Record<SkinToneId, EmojiSequence>>;
}

/**
 * Версия датасета, из которого сгенерирован каталог — только для отладки/тестов,
 * ни на что функционально не влияет (кэш не завязан на неё: чанк фронта уже
 * фингерпринтится сборкой Vite, HTTP-роута с cache-control тут нет).
 */
export const EMOJI_CATALOG_VERSION = 'emojibase-data@17.0.0';
