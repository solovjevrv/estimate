import type { BoardPresenceEntry } from '@poker/shared';
import { nextTick, ref, shallowRef, type Ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useBoardViewport } from '../src/features/boards/composables/use-board-viewport';
import type {
  BoardCamera,
  BoardViewport,
  BoardViewportOptions,
} from '../src/features/boards/composables/use-board-viewport';
import {
  BOARD_CAMERA_THROTTLE_MS,
  BOARD_CURSOR_THROTTLE_MS,
} from '../src/lib/board/board-constants';

function restoreFullscreen(): void {
  const d = document as unknown as Record<string, unknown>;
  if ('fullscreenElement' in d) delete d.fullscreenElement;
  if ('exitFullscreen' in d) delete d.exitFullscreen;
}

interface MakeResult {
  vp: BoardViewport;
  sendAwareness: ReturnType<typeof vi.fn>;
  setViewport: ReturnType<typeof vi.fn>;
  zoomTo: ReturnType<typeof vi.fn>;
  fitView: ReturnType<typeof vi.fn>;
  followParticipant: ReturnType<typeof vi.fn>;
  stopFollowing: ReturnType<typeof vi.fn>;
  project: ReturnType<typeof vi.fn>;
  viewportRef: Ref<BoardCamera>;
  followedParticipantId: Ref<string | null>;
  cameraOfFollowed: Ref<BoardCamera | null>;
  rootEl: Ref<HTMLElement | null>;
}

function makeViewport(overrides: Partial<BoardViewportOptions> = {}): MakeResult {
  const sendAwareness = vi.fn<(kind: 'cursor' | 'camera', data: Record<string, number>) => void>();
  const setViewport = vi.fn<(camera: BoardCamera, options: { duration: number }) => void>();
  const zoomTo = vi.fn<(zoom: number) => void>();
  const fitView = vi.fn<() => void>();
  const project = vi.fn((p: { x: number; y: number }) => ({ x: p.x * 10, y: p.y * 10 }));

  const viewportRef = ref<BoardCamera>({ x: 0, y: 0, zoom: 1 });
  const followedParticipantId = ref<string | null>(null);
  const cameraOfFollowed = ref<BoardCamera | null>(null);
  // shallowRef — как useTemplateRef: хранит сырой DOM-элемент, чтобы
  // сравнение `document.fullscreenElement === rootEl.value` работало по identity
  const rootEl = shallowRef<HTMLElement | null>(null);

  // Хранилище-заглушка: followParticipant/stopFollowing реально меняют
  // реактивный ref, иначе нельзя отследить переключение follow в тестах.
  const followParticipant = vi.fn((id: string) => {
    followedParticipantId.value = id;
  });
  const stopFollowing = vi.fn(() => {
    followedParticipantId.value = null;
  });

  const opts: BoardViewportOptions = {
    canEdit: () => true,
    rootEl,
    viewport: viewportRef,
    project,
    setViewport,
    zoomTo,
    fitView,
    sendAwareness,
    participantId: () => 'self',
    presence: () => [],
    followedParticipantId,
    cameraOfFollowed,
    followParticipant,
    stopFollowing,
    ...overrides,
  };

  const vp = useBoardViewport(opts);
  return {
    vp,
    sendAwareness,
    setViewport,
    zoomTo,
    fitView,
    followParticipant,
    stopFollowing,
    project,
    viewportRef,
    followedParticipantId,
    cameraOfFollowed,
    rootEl: opts.rootEl as Ref<HTMLElement | null>,
  };
}

const fakeRect = {
  left: 100,
  top: 50,
  right: 900,
  bottom: 700,
  width: 800,
  height: 650,
};

function fakeElement(rect = fakeRect): HTMLElement {
  return {
    getBoundingClientRect: () => rect,
    requestFullscreen: vi.fn(),
  } as unknown as HTMLElement;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreFullscreen();
});

describe('useBoardViewport — zoomPercent', () => {
  it('округляет zoom до процентов', () => {
    const { vp, viewportRef } = makeViewport();
    expect(vp.zoomPercent.value).toBe(100);
    viewportRef.value = { x: 0, y: 0, zoom: 1.234 };
    expect(vp.zoomPercent.value).toBe(123);
    viewportRef.value = { x: 0, y: 0, zoom: 0.6 };
    expect(vp.zoomPercent.value).toBe(60);
  });
});

describe('useBoardViewport — cursor awareness', () => {
  it('editable pointer project-ит координаты относительно root и отправляет cursor awareness', () => {
    const { vp, sendAwareness, project } = makeViewport({
      rootEl: shallowRef(fakeElement()),
    });
    const event = new MouseEvent('mousemove', { clientX: 120, clientY: 60 });

    vp.cursorThrottler(event);

    // clientX - rect.left = 20 ; clientY - rect.top = 10
    expect(project).toHaveBeenCalledWith({ x: 20, y: 10 });
    expect(sendAwareness).toHaveBeenCalledWith('cursor', { x: 200, y: 100 });
  });

  it('read-only pointer не отправляет awareness', () => {
    const { vp, sendAwareness } = makeViewport({
      rootEl: shallowRef(fakeElement()),
      canEdit: () => false,
    });
    const event = new MouseEvent('mousemove', { clientX: 120, clientY: 60 });

    vp.cursorThrottler(event);

    expect(sendAwareness).not.toHaveBeenCalled();
  });

  it('отсутствующий root даёт { x: 0, y: 0 }', () => {
    const { vp, sendAwareness } = makeViewport(); // rootEl === null
    const event = new MouseEvent('mousemove', { clientX: 999, clientY: 999 });

    vp.cursorThrottler(event);

    expect(sendAwareness).toHaveBeenCalledWith('cursor', { x: 0, y: 0 });
  });

  it('throttle объединяет частые события; trailing передаёт последнюю позицию', () => {
    vi.useFakeTimers();
    const { vp, sendAwareness } = makeViewport({ rootEl: shallowRef(fakeElement()) });

    // leading: 20/10 -> 200/100
    vp.cursorThrottler(new MouseEvent('mousemove', { clientX: 120, clientY: 60 }));
    // trailing: 220/110 -> 2200/1100
    vp.cursorThrottler(new MouseEvent('mousemove', { clientX: 320, clientY: 160 }));

    expect(sendAwareness).toHaveBeenCalledTimes(1);
    expect(sendAwareness).toHaveBeenLastCalledWith('cursor', { x: 200, y: 100 });

    vi.advanceTimersByTime(BOARD_CURSOR_THROTTLE_MS + 1);
    expect(sendAwareness).toHaveBeenCalledTimes(2);
    expect(sendAwareness).toHaveBeenLastCalledWith('cursor', { x: 2200, y: 1100 });
  });
});

describe('useBoardViewport — camera awareness & follow', () => {
  it('изменение viewport отправляет camera awareness с последними x/y/zoom', async () => {
    const { sendAwareness, viewportRef } = makeViewport();
    viewportRef.value = { x: 5, y: 6, zoom: 2 };
    await nextTick();

    expect(sendAwareness).toHaveBeenCalledWith('camera', { x: 5, y: 6, zoom: 2 });
  });

  it('follow-mode блокирует отправку собственной камеры', async () => {
    const { sendAwareness, viewportRef, followedParticipantId } = makeViewport();
    followedParticipantId.value = 'p2';
    viewportRef.value = { x: 5, y: 6, zoom: 2 };
    await nextTick();

    expect(sendAwareness).not.toHaveBeenCalled();
  });

  it('изменение cameraOfFollowed вызывает setViewport(camera, { duration: 200 })', async () => {
    const { setViewport, cameraOfFollowed } = makeViewport();
    cameraOfFollowed.value = { x: 1, y: 2, zoom: 3 };
    await nextTick();

    expect(setViewport).toHaveBeenCalledWith({ x: 1, y: 2, zoom: 3 }, { duration: 200 });
  });

  it('cameraOfFollowed === null не вызывает setViewport', async () => {
    const { setViewport, cameraOfFollowed } = makeViewport();
    cameraOfFollowed.value = null;
    await nextTick();

    expect(setViewport).not.toHaveBeenCalled();
  });

  it('onManualCameraInteraction снимает follow только при активном follow', () => {
    const { vp, stopFollowing, followedParticipantId } = makeViewport();

    vp.onManualCameraInteraction();
    expect(stopFollowing).not.toHaveBeenCalled();

    followedParticipantId.value = 'other';
    vp.onManualCameraInteraction();
    expect(stopFollowing).toHaveBeenCalledOnce();
  });

  it('breakFollowOnEdit снимает follow только для editable', () => {
    const { vp, stopFollowing, followedParticipantId } = makeViewport({
      canEdit: () => false,
    });

    followedParticipantId.value = 'other';
    vp.breakFollowOnEdit();
    expect(stopFollowing).not.toHaveBeenCalled();

    const editable = makeViewport({ canEdit: () => true });
    editable.followedParticipantId.value = 'other';
    editable.vp.breakFollowOnEdit();
    expect(editable.stopFollowing).toHaveBeenCalledOnce();

    const editableNoFollow = makeViewport({ canEdit: () => true });
    editableNoFollow.vp.breakFollowOnEdit();
    expect(editableNoFollow.stopFollowing).not.toHaveBeenCalled();
  });

  it('resetZoom / fitViewport снимают follow и вызывают верную Vue Flow callback', () => {
    const { vp, stopFollowing, zoomTo, fitView, followedParticipantId } = makeViewport();
    followedParticipantId.value = 'other';

    vp.resetZoom();
    expect(stopFollowing).toHaveBeenCalledOnce();
    expect(zoomTo).toHaveBeenCalledWith(1);

    followedParticipantId.value = 'other';
    vp.fitViewport();
    expect(stopFollowing).toHaveBeenCalledTimes(2);
    expect(fitView).toHaveBeenCalledOnce();
  });
});

describe('useBoardViewport — presence / follow UI', () => {
  const selfEntry: BoardPresenceEntry = {
    participantId: 'self',
    userId: 'u1',
    name: 'Я',
    avatarUrl: null,
    isGuest: false,
  };
  const otherEntry: BoardPresenceEntry = {
    participantId: 'p2',
    userId: 'u2',
    name: 'Alice',
    avatarUrl: null,
    isGuest: false,
  };

  it('avatar: self no-op; чужой включает follow; повторный клик выключает', () => {
    const { vp, followParticipant, stopFollowing, followedParticipantId } = makeViewport();

    vp.onPresenceAvatarClick(selfEntry);
    expect(followParticipant).not.toHaveBeenCalled();
    expect(stopFollowing).not.toHaveBeenCalled();

    vp.onPresenceAvatarClick(otherEntry);
    expect(followParticipant).toHaveBeenCalledWith('p2');
    expect(followedParticipantId.value).toBe('p2');

    vp.onPresenceAvatarClick(otherEntry);
    expect(stopFollowing).toHaveBeenCalledOnce();
    expect(followedParticipantId.value).toBeNull();
  });

  it('followedName корректен при найденном пользователе, его отсутствии и отсутствии id', () => {
    const presence: BoardPresenceEntry[] = [
      {
        participantId: 'p1',
        userId: 'u1',
        name: 'Alice',
        avatarUrl: null,
        isGuest: false,
      },
    ];
    const { vp, followedParticipantId } = makeViewport({
      participantId: () => 'me',
      presence: () => presence,
    });

    expect(vp.followedName.value).toBeNull();

    followedParticipantId.value = 'p1';
    expect(vp.followedName.value).toBe('Alice');

    followedParticipantId.value = 'ghost';
    expect(vp.followedName.value).toBeNull();
  });

  it('initials для пустого имени, одного и нескольких слов', () => {
    const { vp } = makeViewport();
    expect(vp.initials('')).toBe('');
    expect(vp.initials('   ')).toBe('');
    expect(vp.initials('John')).toBe('J');
    expect(vp.initials('John Doe')).toBe('JD');
    expect(vp.initials('John Doe Smith')).toBe('JS');
    expect(vp.initials('  john  doe  ')).toBe('JD');
  });
});

describe('useBoardViewport — fullscreen', () => {
  it('attach() синхронизирует fullscreen и не добавляет listener повторно', () => {
    const fakeEl = fakeElement();
    const addSpy = vi.spyOn(document, 'addEventListener');
    const { vp } = makeViewport({ rootEl: shallowRef(fakeEl) });

    Object.defineProperty(document, 'fullscreenElement', { value: fakeEl, configurable: true });

    vp.attach();
    expect(vp.isFullscreen.value).toBe(true);

    const before = addSpy.mock.calls.filter((c) => c[0] === 'fullscreenchange').length;
    expect(before).toBe(1);

    // повторный attach не добавляет listener повторно и не пересынхронизирует
    vp.attach();
    const after = addSpy.mock.calls.filter((c) => c[0] === 'fullscreenchange').length;
    expect(after).toBe(1);
    expect(vp.isFullscreen.value).toBe(true);
  });

  it('toggleFullscreen() выбирает request/exit согласно document.fullscreenElement', () => {
    const exitSpy = vi.fn();
    Object.defineProperty(document, 'exitFullscreen', { value: exitSpy, configurable: true });

    const requestSpy = vi.fn();
    const fakeEl = { requestFullscreen: requestSpy } as unknown as HTMLElement;
    const { vp } = makeViewport({ rootEl: shallowRef(fakeEl) });

    // fullscreen активен — выходим
    Object.defineProperty(document, 'fullscreenElement', { value: fakeEl, configurable: true });
    vp.toggleFullscreen();
    expect(exitSpy).toHaveBeenCalled();
    expect(requestSpy).not.toHaveBeenCalled();

    // fullscreen не активен — запрашиваем
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    vp.toggleFullscreen();
    expect(requestSpy).toHaveBeenCalled();
  });
});

describe('useBoardViewport — dispose / resetAwareness', () => {
  it('dispose() снимает listener и отменяет pending cursor/camera trailing; после fake timers awareness больше не отправляется', async () => {
    vi.useFakeTimers();

    const el = fakeElement();
    const { vp, sendAwareness, viewportRef } = makeViewport({ rootEl: shallowRef(el) });

    const removeSpy = vi.spyOn(document, 'removeEventListener');
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    vp.attach();

    // cursor: leading + trailing
    vp.cursorThrottler(new MouseEvent('mousemove', { clientX: 120, clientY: 60 }));
    vp.cursorThrottler(new MouseEvent('mousemove', { clientX: 320, clientY: 160 }));

    // camera: leading + trailing
    viewportRef.value = { x: 1, y: 1, zoom: 1 };
    await nextTick();
    viewportRef.value = { x: 2, y: 2, zoom: 2 };
    await nextTick();

    // leading: cursor(200,100) + camera(1,1,1)
    expect(sendAwareness).toHaveBeenCalledTimes(2);

    vp.dispose();

    expect(removeSpy).toHaveBeenCalledWith('fullscreenchange', expect.any(Function));

    // trailing отменён — ни cursor, ни camera больше не посылаются
    vi.advanceTimersByTime(BOARD_CURSOR_THROTTLE_MS + BOARD_CAMERA_THROTTLE_MS + 100);
    expect(sendAwareness).toHaveBeenCalledTimes(2);
  });

  it('повторный dispose() безопасен', () => {
    const { vp } = makeViewport();
    expect(() => {
      vp.dispose();
      vp.dispose();
    }).not.toThrow();
  });

  it('resetAwareness отменяет trailing без снятия fullscreen listener', async () => {
    vi.useFakeTimers();

    const { vp, sendAwareness, viewportRef } = makeViewport();
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    vp.attach();
    expect(removeSpy).not.toHaveBeenCalled();

    viewportRef.value = { x: 1, y: 1, zoom: 1 };
    await nextTick(); // leading camera
    viewportRef.value = { x: 2, y: 2, zoom: 2 };
    await nextTick(); // trailing camera

    vp.resetAwareness();
    vi.advanceTimersByTime(BOARD_CAMERA_THROTTLE_MS + 10);
    expect(sendAwareness).toHaveBeenCalledTimes(1);
    expect(removeSpy).not.toHaveBeenCalled();
  });
});
