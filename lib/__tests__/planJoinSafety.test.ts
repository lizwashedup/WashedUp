import fs from 'node:fs';
import path from 'node:path';
import { joinErrorSurface } from '../planJoinSafety';

describe('plan join safety', () => {
  test('uses an inline error only while the join sheet is visible', () => {
    expect(joinErrorSurface(true)).toBe('inline');
    expect(joinErrorSurface(false)).toBe('alert');
  });

  test('keeps join failures visible inside the open join sheet', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/plan/[id].tsx'),
      'utf8',
    );

    expect(source).toContain("logError(error, 'plan.join')");
    expect(source).toContain("joinErrorSurface(joinModalVisible) === 'inline'");
    expect(source).toContain('{joinError ? <Text style={joinStyles.error}>{joinError}</Text> : null}');
    expect(source).toContain('if (shareAfterJoinPending)');
    expect(source).toContain('disabled={joinMutation.isPending}');
    expect(source).not.toContain("error.message?.includes('does not exist')");
    expect(source).not.toContain("(error as any).code === '42883'");
  });
});
