/**
 * «Недавние» эмодзи в пикере (21.4) — без БД (задача явно этого не
 * предполагает), поэтому история живёт в localStorage браузера: своя на
 * каждом устройстве, переживает перезагрузку страницы.
 */

const STORAGE_KEY = 'estimate-recent-emoji';
const MAX_RECENT = 24;

export function getRecentEmoji(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

export function addRecentEmoji(emoji: string): void {
  try {
    const next = [emoji, ...getRecentEmoji().filter((e) => e !== emoji)].slice(0, MAX_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // приватный режим/заполненная квота — недавние не критичны
  }
}
