import { useCallback } from 'react';
// import * as Crypto from 'expo-crypto'; // V2: re-enable with recordInvite (ghost avatars)
import { supabase } from '../lib/supabase';

/**
 * Referral / text-invite client.
 *
 * Phone-hash contract: SHA-256 hex (lowercase) of the SAME normalized
 * E.164 string stored in profiles.phone_number, matching the
 * link_referral_on_signup trigger's
 * encode(extensions.digest(phone_number,'sha256'),'hex').
 */
export function useReferral() {
  /** Lazily generate (or fetch) the caller's referral code. */
  const ensureReferralCode = useCallback(
    async (userId: string): Promise<string> => {
      const { data, error } = await supabase.rpc('ensure_referral_code', {
        p_user_id: userId,
      });
      if (error) throw error;
      return data as string;
    },
    [],
  );

  // V2: ghost avatars. `recordInvite` was the only caller of the
  // `record_referral_invite` RPC — it has zero call sites anywhere in the
  // client, so the text-invite ghost-avatar write path is dead for v1.
  // Descoped per the audit (requires OneSignal number capture + the
  // pre-signup deferred deep-link flow before it's usable). The DB tables
  // and RPCs (record_referral_invite, link_referral_on_signup) are left
  // intact for V2; only the unused client path is removed. To restore:
  // re-enable the expo-crypto import above and re-add this to the return.
  //
  // const recordInvite = useCallback(
  //   async (e164Phone: string, contactName?: string): Promise<string> => {
  //     const phoneHash = await Crypto.digestStringAsync(
  //       Crypto.CryptoDigestAlgorithm.SHA256,
  //       e164Phone,
  //       { encoding: Crypto.CryptoEncoding.HEX },
  //     );
  //     const { data, error } = await supabase.rpc('record_referral_invite', {
  //       p_phone_hash: phoneHash,
  //       p_contact_name: contactName ?? null,
  //     });
  //     if (error) throw error;
  //     return data as string;
  //   },
  //   [],
  // );

  return { ensureReferralCode };
}
