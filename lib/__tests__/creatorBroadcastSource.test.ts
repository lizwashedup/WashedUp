import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

describe('in-app creator broadcast source contract', () => {
  it('keeps creator sends on the guarded community broadcast insert path', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'lib/creatorMode.ts'), 'utf8');
    expect(source).toMatch(/function sendBroadcast[\s\S]*from\('community_broadcasts'\)\.insert/);
    expect(source).toMatch(/body: body\.trim\(\)/);
  });

  it('fans broadcasts only to active, unmuted members other than the sender', () => {
    const sql = fs.readFileSync(
      path.join(repoRoot, 'supabase/migrations/20260708220000_open_composer.sql'),
      'utf8',
    );
    const functionBody = sql.match(
      /create or replace function public\.notify_community_broadcast\(\)[\s\S]*?\$function\$;/i,
    )?.[0] ?? '';
    expect(functionBody).toContain("new.kind in ('intro', 'message')");
    expect(functionBody).toContain("m.status = 'active'");
    expect(functionBody).toContain('not m.broadcasts_muted');
    expect(functionBody).toContain('m.user_id is distinct from new.sender_id');
    const triggerSql = fs.readFileSync(
      path.join(repoRoot, 'supabase/migrations/20260706150000_mvp_batch.sql'),
      'utf8',
    );
    expect(triggerSql).toMatch(
      /trigger trg_notify_community_broadcast[\s\S]*after insert on public\.community_broadcasts/i,
    );
  });
});
