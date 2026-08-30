import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('creator layout access failure contract', () => {
  const source = readFileSync(resolve(__dirname, '../../app/(creator)/_layout.tsx'), 'utf8');

  it('handles query failure before any no-access redirect', () => {
    expect(source.indexOf('if (isError)')).toBeGreaterThan(-1);
    expect(source.indexOf('if (isError)')).toBeLessThan(source.indexOf('if (!hasCreatorAccess(access))'));
  });

  it('keeps the creator in place with an explicit retry action', () => {
    expect(source).toContain('CreatorAccessErrorScreen');
    expect(source).toContain('retry={() => void refetch()}');
    expect(source).toContain('accessibilityLabel="Retry creator access"');
  });
});
