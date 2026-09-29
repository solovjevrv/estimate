import { describe, expect, it } from 'vitest';

import { useEntityModal } from '../src/composables/use-entity-modal';

describe('useEntityModal', () => {
  it('открывает и закрывает модалку через единый API', () => {
    const modal = useEntityModal();

    expect(modal.open).toBe(false);

    modal.show();
    expect(modal.open).toBe(true);

    modal.close();
    expect(modal.open).toBe(false);
  });
});
