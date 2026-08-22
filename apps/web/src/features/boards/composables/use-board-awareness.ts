import type {
  BoardAwarenessBroadcast,
  BoardCameraAwarenessData,
  BoardPresenceEntry,
} from '@poker/shared';
import { computed, reactive, ref } from 'vue';

/**
 * Presence и эфемерная осведомлённость участников доски: список присутствия,
 * курсоры (awareness), мягкая блокировка редактирования (14.2) и камера
 * follow-mode (14.5) — три отдельные карты, а не одна: throttled cursor
 * (каждые 80мс) не должен затирать записи editing/camera того же
 * participantId между чтениями наблюдателя. Не знает о сокете и WS-протоколе —
 * `handlePresence`/`handleAwareness` вызываются из обработчиков событий
 * снаружи (16.5).
 */
export function useBoardAwareness() {
  const presence = ref<BoardPresenceEntry[]>([]);
  const awarenessByParticipant = reactive(new Map<string, BoardAwarenessBroadcast>());
  const editingByItem = reactive(new Map<string, { participantId: string; name: string }>());
  const cameraByParticipant = reactive(new Map<string, BoardCameraAwarenessData>());
  const followedParticipantId = ref<string | null>(null);

  const awareness = computed(() => [...awarenessByParticipant.values()]);
  const cameraOfFollowed = computed(() =>
    followedParticipantId.value
      ? (cameraByParticipant.get(followedParticipantId.value) ?? null)
      : null,
  );

  function followParticipant(id: string): void {
    followedParticipantId.value = id;
  }

  function stopFollowing(): void {
    followedParticipantId.value = null;
  }

  function handlePresence(entries: BoardPresenceEntry[]): void {
    presence.value = entries;
    // Awareness (курсоры, 14.1) не приходит событием "участник ушёл" — без
    // этой сверки курсор отключившегося застывал бы на экране навсегда
    // (последняя полученная позиция), так как awarenessByParticipant пополняется,
    // но никогда сам по себе не убывает. presence — источник истины о том,
    // кто сейчас реально на доске.
    const activeIds = new Set(entries.map((entry) => entry.participantId));
    for (const participantId of awarenessByParticipant.keys()) {
      if (!activeIds.has(participantId)) awarenessByParticipant.delete(participantId);
    }
    // Та же самая «призрачная блокировка» (14.2): если участник отключился,
    // его editing-запись тоже навсегда не исчезнет без этой сверки — и
    // элемент останется недоступным для редактирования вечно.
    for (const [itemId, lock] of editingByItem) {
      if (!activeIds.has(lock.participantId)) editingByItem.delete(itemId);
    }
    // Камера того же участника (14.5) тоже не приходит в "ушёл" — чистим вместе
    for (const [id] of cameraByParticipant) {
      if (!activeIds.has(id)) cameraByParticipant.delete(id);
    }
    if (followedParticipantId.value && !activeIds.has(followedParticipantId.value)) {
      followedParticipantId.value = null; // объект слежения ушёл с доски — авто-отписка
    }
  }

  function handleAwareness(payload: BoardAwarenessBroadcast): void {
    // Камера (14.5) — отдельная карта, а не в awarenessByParticipant: иначе
    // throttled cursor (каждые 80мс) затирал бы запись камеры того же
    // participantId до того, как её успеет прочитать наблюдатель follow-mode
    if (payload.kind === 'camera') {
      cameraByParticipant.set(
        payload.participantId,
        payload.data as unknown as BoardCameraAwarenessData,
      );
      return;
    }
    // Мягкая блокировка редактирования (14.2) — отдельная ветка, НЕ
    // трогает awarenessByParticipant: курсорные патчи (mousemove) не должны
    // затирать editing-запись, иначе индикатор блокировки погаснет посреди
    // реального редактирования
    if (payload.kind === 'editing') {
      const { itemId, active: isActive } = payload.data as {
        itemId: string;
        active: boolean;
      };
      if (isActive) {
        editingByItem.set(itemId, {
          participantId: payload.participantId,
          name: payload.name,
        });
      } else if (editingByItem.get(itemId)?.participantId === payload.participantId) {
        editingByItem.delete(itemId);
      }
      return;
    }
    awarenessByParticipant.set(payload.participantId, payload);
  }

  /** Смена доски или выход — прошлая осведомлённость не имеет смысла на новой/пустой сессии */
  function reset(): void {
    presence.value = [];
    awarenessByParticipant.clear();
    editingByItem.clear();
    cameraByParticipant.clear();
    followedParticipantId.value = null;
  }

  return {
    presence,
    awareness,
    editingByItem,
    cameraByParticipant,
    followedParticipantId,
    cameraOfFollowed,
    followParticipant,
    stopFollowing,
    handlePresence,
    handleAwareness,
    reset,
  };
}
