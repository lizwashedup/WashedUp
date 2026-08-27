import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260827210000_claim_referral_invite_from_shared_link.sql',
  ),
  'utf8',
);

describe('claim_referral_invite database contract', () => {
  it('creates the people request from inviter to authenticated recipient', () => {
    expect(sql).toMatch(
      /VALUES\s*\(v_inviter,\s*v_recipient,\s*'pending',\s*'referral_invite'/s,
    );
    expect(sql).not.toMatch(
      /VALUES\s*\(v_recipient,\s*v_inviter,\s*'pending',\s*'referral_invite'/s,
    );
  });

  it('is authenticated-only and checks blocks and terminal rejections', () => {
    expect(sql).toContain('v_recipient uuid := auth.uid()');
    expect(sql).toContain('yours_is_blocked_between(v_inviter, v_recipient)');
    expect(sql).toContain("pc.status IN ('declined', 'removed')");
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.claim_referral_invite(text) TO authenticated',
    );
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.claim_referral_invite(text) FROM anon',
    );
  });
});
