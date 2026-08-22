import { BLOCK_TYPE_INFO, BLOCK_TYPE_ORDER, defaultContentFor } from '../communityBlocks';

describe('cadence block type (C-05)', () => {
  it('has display info and a default empty-text content shape', () => {
    expect(BLOCK_TYPE_INFO.cadence.label).toBe('what membership feels like');
    expect(defaultContentFor('cadence')).toEqual({ text: '' });
  });

  it('is offered in the add-a-block sheet', () => {
    expect(BLOCK_TYPE_ORDER).toContain('cadence');
  });
});
