import { supabase } from './supabase';

/**
 * Phone-canonical reconciliation.
 *
 * Asks the server whether the phone the (currently-authed) user is trying to
 * attach already belongs to a DIFFERENT account, i.e. the current account is
 * a duplicate shell (typically an Apple sign-in that collided with an existing
 * phone account). Backed by the SECURITY DEFINER RPC `reconcile_account_by_phone`
 * (lookup only: no session minting, no deletes, no PII returned).
 *
 * `auth.users.phone` is UNIQUE, so a phone resolves to at most one account; that
 * account is canonical. The client uses `isDup` to decide whether to sign the
 * user into the canonical account instead of dead-ending.
 */
export type ReconcileDecision = {
  /** The phone already belongs to a different account (the real one). */
  isDup: boolean;
  /** The current shell is safe to remove later (recent + empty). */
  shellDeletable: boolean;
  /** The current shell has its own content, must NOT be auto-removed. */
  shellHasContent: boolean;
};

const NOT_DUP: ReconcileDecision = {
  isDup: false,
  shellDeletable: false,
  shellHasContent: false,
};

export async function reconcileAccountByPhone(e164: string): Promise<ReconcileDecision> {
  const { data, error } = await supabase.rpc('reconcile_account_by_phone', {
    p_e164: e164,
  });
  // Fail CLOSED: any error / unexpected shape -> treat as not-a-dup so the
  // caller falls back to the existing (safe) phone-attach flow rather than
  // doing anything clever on bad data.
  if (error || !Array.isArray(data) || !data[0]) return NOT_DUP;
  const row = data[0] as {
    is_dup?: boolean;
    shell_deletable?: boolean;
    shell_has_content?: boolean;
  };
  return {
    isDup: !!row.is_dup,
    shellDeletable: !!row.shell_deletable,
    shellHasContent: !!row.shell_has_content,
  };
}
