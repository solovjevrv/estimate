/**
 * «Недавние» эмодзи в пикере (21.4) — без БД (задача явно этого не
 * предполагает), поэтому история живёт в localStorage браузера: своя на
 * каждом устройстве, переживает перезагрузку страницы.
 */

const STORAGE_KEY = 'estimate-recent-emoji';
const MAX_RECENT = 24;

/**
 * Пока пользователь ни разу не поставил реакцию, секция «Недавние» была бы
 * пустой (и вовсе скрытой — см. `v-if="recent.length > 0"` в EmojiPicker.vue).
 * Чтобы первый заход не показывал пустой пикер, сеем этот набор в хранилище
 * вместо пустого списка. Дальше он живёт как обычная MRU-запись: реальные
 * выборы пользователя обычной логикой `addRecentEmoji` поднимаются наверх и
 * постепенно вытесняют дефолты за пределы `MAX_RECENT` — отдельно "снимать"
 * дефолты не нужно.
 */
export const DEFAULT_RECENT_EMOJI: readonly string[] = [
  '👍',
  '👎',
  '😂',
  '🤔',
  '🎉',
  '👏',
  '🔥',
  '❤️',
  '😅',
  '🙌',
  '☕',
  '💯',
];

export function getRecentEmoji(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === 'string');
      }
    }
  } catch {
    // приватный режим/повреждённые данные — вернём дефолты как в первый заход
  }
  const seeded = [...DEFAULT_RECENT_EMOJI];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  } catch {
    // квота/приватный режим — дефолты всё равно покажем в этой сессии, просто не сохранятся
  }
  return seeded;
}

export function addRecentEmoji(emoji: string): void {
  try {
    const next = [emoji, ...getRecentEmoji().filter((e) => e !== emoji)].slice(0, MAX_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // приватный режим/заполненная квота — недавние не критичны
  }
}
