import { Linking, Platform, Share } from 'react-native';

/**
 * Text-invite helper. No expo-sms dependency: uses the native sms: intent,
 * falling back to the system share sheet.
 *
 * Known v1 limitation: the native composer does not return the chosen
 * number, so a ghost avatar (referral_invites row) is only created when a
 * number is captured elsewhere. The referral still resolves at signup via
 * the link code -> link_referral_on_signup. Copy is dash-free per the
 * project rule.
 */
export function buildReferralLink(code: string): string {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(code)) throw new Error('Invalid referral code');
  return `https://washedup.app/r/${code}`;
}

export function buildInviteText(code: string): string {
  return `I'm using WashedUp to plan stuff with people I actually like hanging out with. Join me: ${buildReferralLink(code)}`;
}

export async function openInviteComposer(code: string, isCurrent: () => boolean = () => true): Promise<void> {
  if (!isCurrent()) return;
  const body = buildInviteText(code);
  const sep = Platform.OS === 'ios' ? '&' : '?';
  const url = `sms:${sep}body=${encodeURIComponent(body)}`;
  try {
    const ok = await Linking.canOpenURL(url);
    if (!isCurrent()) return;
    if (ok) {
      await Linking.openURL(url);
      return;
    }
  } catch {
    /* fall through to share sheet */
  }
  if (!isCurrent()) return;
  await Share.share({ message: body });
}
