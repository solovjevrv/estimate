import type { BoardPresenceEntry } from '@estimate/shared';
import { computed, ref, type Ref, watch } from 'vue';

import {
  BOARD_CAMERA_THROTTLE_MS,
  BOARD_CURSOR_THROTTLE_MS,
} from '../../../features/boards/config/board-constants';
import { throttle } from '../../../lib/throttle';

export interface BoardCamera {
  x: number;
  y: number;
  zoom: number;
}

export interface BoardViewportOptions {
  canEdit: () => boolean;
  rootEl: Readonly<Ref<HTMLElement | null>>;

  /** Реактивный viewport Vue Flow. */
  viewport: Readonly<Ref<BoardCamera>>;
  project: (point: { x: number; y: number }) => { x: number; y: number };
  setViewport: (camera: BoardCamera, options: { duration: number }) => void | Promise<unknown>;
  zoomTo: (zoom: number) => void | Promise<unknown>;
  fitView: () => void | Promise<unknown>;

  sendAwareness: (
    kind: 'cursor' | 'camera',
    data: Record<string, number>,
  ) => void | Promise<unknown>;

  participantId: () => string | null;
  presence: () => readonly BoardPresenceEntry[];
  followedParticipantId: Readonly<Ref<string | null>>;
  cameraOfFollowed: Readonly<Ref<BoardCamera | null>>;
  followParticipant: (participantId: string) => void;
  stopFollowing: () => void;
}

export interface BoardViewport {
  zoomPercent: Readonly<Ref<number>>;
  isFullscreen: Readonly<Ref<boolean>>;
  followedName: Readonly<Ref<string | null>>;

  cursorThrottler: (event: MouseEvent) => void;
  onManualCameraInteraction: () => void;
  onPresenceAvatarClick: (entry: BoardPresenceEntry) => void;
  breakFollowOnEdit: () => void;
  resetZoom: () => void;
  fitViewport: () => void;
  toggleFullscreen: () => void;
  initials: (name: string) => string;

  /** Идемпотентно добавляет fullscreen listener и синхронизирует состояние. */
  attach: () => void;
  /** Снимает listener и отменяет trailing cursor/camera throttles. Идемпотентен. */
  dispose: () => void;
  /**
   * Отменяет pending trailing cursor/camera вызовы без снятия fullscreen
   * listener — используется при смене доски, когда холст не размонтируется.
   */
  resetAwareness: () => void;
}

export function useBoardViewport(options: BoardViewportOptions): BoardViewport {
  const zoomPercent = computed(() => Math.round(options.viewport.value.zoom * 100));
  const isFullscreen = ref(false);
  const followedName = computed(() => {
    const id = options.followedParticipantId.value;
    if (!id) return null;
    return options.presence().find((p) => p.participantId === id)?.name ?? null;
  });

  /** Инициалы из имени для fallback-аватарки (14.1) */
  function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0]![0]!.toUpperCase();
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  }

  /**
   * Позиция мыши проецируется в canvas-координаты через `project()`. При
   * отсутствии rootEl (до монтирования/при teardown) используется {0,0}.
   * Только редактор транслирует курсор — зрительный курсор не интересен.
   */
  function onPointerMove(event: MouseEvent): void {
    if (!options.canEdit()) return;
    const el = options.rootEl.value;
    const rect = el?.getBoundingClientRect() ?? null;
    const point = rect
      ? options.project({ x: event.clientX - rect.left, y: event.clientY - rect.top })
      : { x: 0, y: 0 };
    void options.sendAwareness('cursor', { x: point.x, y: point.y });
  }

  /**
   * Собственная камера — throttled-рассылка позиции viewport на каждый пан/зум.
   * Грубее курсора (BOARD_CAMERA_THROTTLE_MS), чтобы не слепо перегружать сеть
   * панорамированием.
   */
  const cursorThrottler = throttle(onPointerMove, BOARD_CURSOR_THROTTLE_MS);
  const cameraThrottler = throttle(() => {
    void options.sendAwareness('camera', {
      x: options.viewport.value.x,
      y: options.viewport.value.y,
      zoom: options.viewport.value.zoom,
    });
  }, BOARD_CAMERA_THROTTLE_MS);

  // Глубокий watch за viewport: пока мы сами кого-то смотрим — не транслируем
  // свою камеру, иначе программно подставленная follow-камера эхом улетала бы
  // моим наблюдателям как «настоящая» позиция — путаница и потенциальный цикл.
  watch(
    () => options.viewport.value,
    () => {
      if (options.followedParticipantId.value !== null) return;
      cameraThrottler();
    },
    { deep: true },
  );

  // Следим за камерой того, за кого смотрим — плавно переносим наш viewport.
  watch(
    () => options.cameraOfFollowed.value,
    (cam) => {
      if (!cam) return;
      void options.setViewport({ x: cam.x, y: cam.y, zoom: cam.zoom }, { duration: 200 });
    },
  );

  function onManualCameraInteraction(): void {
    if (options.followedParticipantId.value !== null) {
      options.stopFollowing();
    }
  }

  function breakFollowOnEdit(): void {
    // Только редактор может вмешаться — read-only просмотр слежение не разрывает.
    if (options.canEdit() && options.followedParticipantId.value !== null) {
      options.stopFollowing();
    }
  }

  function resetZoom(): void {
    options.stopFollowing();
    void options.zoomTo(1);
  }

  function fitViewport(): void {
    options.stopFollowing();
    void options.fitView();
  }

  function onPresenceAvatarClick(entry: BoardPresenceEntry): void {
    if (entry.participantId === options.participantId()) return;
    if (options.followedParticipantId.value === entry.participantId) {
      options.stopFollowing();
    } else {
      options.followParticipant(entry.participantId);
    }
  }

  function onFullscreenChange(): void {
    isFullscreen.value = document.fullscreenElement === options.rootEl.value;
  }

  function toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void options.rootEl.value?.requestFullscreen();
    }
  }

  let attached = false;
  function attach(): void {
    if (attached) return;
    attached = true;
    onFullscreenChange();
    document.addEventListener('fullscreenchange', onFullscreenChange);
  }

  function resetAwareness(): void {
    cursorThrottler.cancel();
    cameraThrottler.cancel();
  }

  function dispose(): void {
    if (!attached) {
      // Холст мог быть смонтирован, а attach() не вызывался (или уже dispose).
      // Всё равно гарантируем чистоту throttle-таймеров при teardown.
      resetAwareness();
      return;
    }
    attached = false;
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    resetAwareness();
  }

  return {
    zoomPercent,
    isFullscreen,
    followedName,
    cursorThrottler,
    onManualCameraInteraction,
    onPresenceAvatarClick,
    breakFollowOnEdit,
    resetZoom,
    fitViewport,
    toggleFullscreen,
    initials,
    attach,
    dispose,
    resetAwareness,
  };
}
