// The provider notifies auth listeners before its signOut promise resolves.
// Only the listener observing the departure of the intended account may
// forget this device. A refusal or a replacement session retires the intent.
let active: { userId: string } | null = null;

export async function withProfileSignOutIntent<T>(userId: string, signOut: () => Promise<T>): Promise<T> {
  const intent = { userId };
  active = intent;
  try { return await signOut(); }
  finally { if (active === intent) active = null; }
}

export function observeProfileSignOut(event: string, previousUser: string | null, nextUser: string | null): boolean {
  if (!active) return false;
  if (event === 'SIGNED_OUT') {
    const matches = !nextUser && active.userId === previousUser;
    active = null;
    return matches;
  }
  if (event === 'PASSWORD_RECOVERY' || (nextUser && nextUser !== active.userId)) active = null;
  return false;
}
