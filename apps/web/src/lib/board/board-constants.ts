/**
 * Shared constants for board module
 * Extracted from magic numbers in BoardCanvas.vue and board-op-history.ts
 */

// Drag throttle interval in milliseconds (BoardCanvas.vue)
export const BOARD_DRAG_THROTTLE_MS = 80;

// Duplicate offset in pixels when duplicating items (BoardCanvas.vue)
export const BOARD_DUPLICATE_OFFSET = 24;

// Maximum history entries for undo/redo (board-op-history.ts)
export const BOARD_HISTORY_LIMIT = 100;