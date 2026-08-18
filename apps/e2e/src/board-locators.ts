import type { Locator, Page } from '@playwright/test';

/**
 * Централизованный набор data-testid-локаторов для досок.
 *
 * Все селекторы используют `[data-testid="..."]` вместо хрупких CSS-классов
 * Vue Flow (`.vue-flow__*`) и внутренних классов досок (`.board-*`).
 *
 * `pane` и `viewport` — это Vue Flow internals, data-testid выставляются
 * JS-адаптером в `onMounted` BoardCanvas.
 */
export interface BoardLocators {
  canvas: Locator;
  joined: Locator;
  canvasRevision: Locator;
  zoom: Locator;
  pane: Locator;
  viewport: Locator;
  flow: Locator;
  stickyNodes: Locator;
  shapeNodes: Locator;
  textNodes: Locator;
  imageNodes: Locator;
  emojiNodes: Locator;
  stickerNodes: Locator;
  frameNodes: Locator;
  groupNodes: Locator;
  selectedNodes: Locator;
  nodeByType: (type: string) => Locator;
  nodeById: (id: string) => Locator;
  nodeNotById: (type: string, id: string) => Locator;
  handle: (nodeId: string, handleId: string) => Locator;
  edges: Locator;
  snapGuides: Locator;
  snapGuide: Locator;
  editingBadge: Locator;
  toolbar: Locator;
  toolbarButton: (ariaLabel: string) => Locator;
  selectionToolbar: Locator;
  selectionToolbarButton: (ariaLabel: string) => Locator;
  contextMenu: Locator;
  presence: Locator;
  presenceAvatars: Locator;
  selfAvatar: Locator;
  nonSelfAvatars: Locator;
  followingAvatar: Locator;
  followingBadge: Locator;
  cursor: Locator;
  cursorName: Locator;
  stickerPicker: Locator;
  stickerPickerSection: (label: string) => Locator;
  formMenu: Locator;
  formMenuButton: (ariaLabel: string) => Locator;
  highlightSwatch: Locator;
  linkInput: Locator;
  linkApplyBtn: Locator;
}

export function boardLocators(pageOrLocator: Page | Locator): BoardLocators {
  const base = pageOrLocator.locator.bind(pageOrLocator);

  return {
    canvas: base('[data-testid="board-canvas"]'),
    joined: base('[data-testid="board-canvas"][data-board-joined="true"]'),
    canvasRevision: base('[data-testid="board-canvas"]'),
    zoom: base('[data-testid="board-zoom"]'),
    pane: base('[data-testid="board-pane"]'),
    viewport: base('[data-testid="board-viewport"]'),
    flow: base('[data-testid="board-flow"]'),

    stickyNodes: base('[data-testid="board-node-sticky"]'),
    shapeNodes: base('[data-testid="board-node-shape"]'),
    textNodes: base('[data-testid="board-node-text"]'),
    imageNodes: base('[data-testid="board-node-image"]'),
    emojiNodes: base('[data-testid="board-node-emoji"]'),
    stickerNodes: base('[data-testid="board-node-sticker"]'),
    frameNodes: base('[data-testid="board-node-frame"]'),
    groupNodes: base('[data-testid="board-node-group"]'),
    selectedNodes: base('[data-selected="true"]'),

    nodeByType: (type: string) => base(`[data-testid="board-node-${type}"]`),
    nodeById: (id: string) => base(`[data-node-id="${id}"]`),
    nodeNotById: (type: string, id: string) =>
      base(`[data-testid="board-node-${type}"]:not([data-node-id="${id}"])`),

    handle: (nodeId: string, handleId: string) =>
      base(`[data-testid="board-handle"][data-nodeid="${nodeId}"][data-handleid="${handleId}"]`),

    edges: base('[data-testid="board-edge"]'),

    snapGuides: base('[data-testid="board-snap-guides"]'),
    snapGuide: base('[data-testid="board-snap-guide"]'),

    editingBadge: base('[data-testid="board-editing-badge"]'),

    toolbar: base('[data-testid="board-toolbar"]'),
    toolbarButton: (ariaLabel: string) =>
      base(`[data-testid="board-toolbar"] button[aria-label="${ariaLabel}"]`),

    selectionToolbar: base('[data-testid="board-selection-toolbar"]'),
    selectionToolbarButton: (ariaLabel: string) =>
      base(`[data-testid="board-selection-toolbar"] button[aria-label="${ariaLabel}"]`),

    contextMenu: base('[data-testid="board-context-menu"]'),

    presence: base('[data-testid="board-presence"]'),
    presenceAvatars: base('[data-testid="board-presence-avatar"]'),
    selfAvatar: base('[data-testid="board-presence-avatar"][data-self="true"]'),
    nonSelfAvatars: base('[data-testid="board-presence-avatar"][data-self="false"]'),
    followingAvatar: base('[data-testid="board-presence-avatar"][data-following="true"]'),
    followingBadge: base('[data-testid="board-following"]'),

    cursor: base('[data-testid="board-cursor"]'),
    cursorName: base('[data-testid="board-cursor-name"]'),

    stickerPicker: base('[data-testid="board-sticker-picker"]'),
    stickerPickerSection: (label: string) =>
      base(`[data-testid="board-sticker-picker-section"]`, { hasText: label }),
    formMenu: base('[data-testid="board-form-menu"]'),
    formMenuButton: (ariaLabel: string) =>
      base(`[data-testid="board-form-menu"] button[aria-label="${ariaLabel}"]`),

    highlightSwatch: base('[data-testid="board-highlight-swatch"]'),
    linkInput: base('[data-testid="board-link-input"]'),
    linkApplyBtn: base('[data-testid="board-link-apply-btn"]'),
  };
}
