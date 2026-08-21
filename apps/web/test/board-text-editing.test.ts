import { describe, expect, it } from 'vitest';

import { selectionEscapedActiveEditor } from '../src/features/boards/domain/board-text-editing';

describe('selectionEscapedActiveEditor (12.23)', () => {
  it('false — only the editing item itself is selected', () => {
    expect(selectionEscapedActiveEditor('a', ['a'])).toBe(false);
  });

  it('false — selection is empty (full deselect is handled separately by watch(isSelected))', () => {
    expect(selectionEscapedActiveEditor('a', [])).toBe(false);
  });

  it('true — another item joined the selection alongside the editing one (shift-click)', () => {
    expect(selectionEscapedActiveEditor('a', ['a', 'b'])).toBe(true);
  });

  it('true — selection moved to a different item entirely', () => {
    expect(selectionEscapedActiveEditor('a', ['b'])).toBe(true);
  });
});
