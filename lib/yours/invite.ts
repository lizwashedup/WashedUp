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
  return `https://washedup.app/r/${code}`;
}

export function buildInviteText(code: string): string {
  return `I'm using WashedUp to plan stuff with people I actually like hanging out with. Join me: ${buildReferralLink(code)}`;
}

export async function openInviteComposer(code: string): Promise<void> {
  const body = buildInviteText(code);
  const sep = Platform.OS === 'ios' ? '&' : '?';
  const url = `sms:${sep}body=${encodeURIComponent(body)}`;
  try {
    const ok = await Linking.canOpenURL(url);
    if (ok) {
      await Linking.openURL(url);
      return;
    }
  } catch {
    /* fall through to share sheet */
  }
  await Share.share({ message: body });
}
