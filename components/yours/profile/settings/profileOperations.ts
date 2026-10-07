import { supabase } from '../../../../lib/supabase';
import { uploadBase64ToStorage } from '../../../../lib/uploadPhoto';

export interface OwnProfile {
  id: string;
  first_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  city: string | null;
  gender: string | null;
  handle: string | null;
  neighborhood: string | null;
  is_visitor: boolean;
  fun_fact: string | null;
}
export interface ProfileOperationScope { userId: string; isCurrent: () => boolean; }
export class ObsoleteProfileOperationError extends Error {
  constructor() { super('This profile action is no longer current.'); this.name = 'ObsoleteProfileOperationError'; }
}
export const isObsoleteProfileOperation = (error: unknown) => error instanceof Error && error.name === 'ObsoleteProfileOperationError';
export function requireProfileScope(scope: ProfileOperationScope) { if (!scope.userId || !scope.isCurrent()) throw new ObsoleteProfileOperationError(); }
export async function verifyProfileOwner(scope: ProfileOperationScope) {
  requireProfileScope(scope);
  const result = await supabase.auth.getUser();
  requireProfileScope(scope);
  if (result.error) throw result.error;
  if (result.data.user?.id !== scope.userId) throw new ObsoleteProfileOperationError();
}
export const normalizeProfileHandle = (value: string) => value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
export async function readOwnProfile(scope: ProfileOperationScope): Promise<OwnProfile | null> {
  await verifyProfileOwner(scope);
  requireProfileScope(scope);
  const { data, error } = await supabase.from('profiles')
    .select('id, first_name_display, profile_photo_url, bio, city, gender, handle, neighborhood, is_visitor, fun_fact')
    .eq('id', scope.userId).single();
  requireProfileScope(scope);
  if (error) throw error;
  if (!data) return null;
  if (data.id !== scope.userId) throw new Error('Could not confirm this profile.');
  return { id: data.id, first_name: data.first_name_display ?? null, avatar_url: data.profile_photo_url ?? null, bio: data.bio ?? null, city: data.city ?? null, gender: data.gender ?? null, handle: data.handle ?? null, neighborhood: data.neighborhood ?? null, is_visitor: data.is_visitor ?? false, fun_fact: data.fun_fact ?? null };
}
export interface OwnProfileEdit {
  name: string;
  handle: string;
  neighborhood: string;
  isVisitor: boolean;
  funFact: string;
  photoUrl: string | null;
  photoBase64: string | null;
}
export async function saveOwnProfile(edit: OwnProfileEdit, scope: ProfileOperationScope) {
  // Capture the original fields before an await. A later edit is a separate
  // deliberate submission, never a replacement for an in-flight payload.
  const snapshot = { ...edit };
  await verifyProfileOwner(scope);
  let photoUrl = snapshot.photoUrl;
  if (snapshot.photoBase64) {
    requireProfileScope(scope);
    const { data: { session }, error } = await supabase.auth.refreshSession();
    requireProfileScope(scope);
    if (error) throw error;
    if (session?.user.id !== scope.userId) throw new ObsoleteProfileOperationError();
    requireProfileScope(scope);
    photoUrl = await uploadBase64ToStorage('profile-photos', `${scope.userId}/${Date.now()}.jpg`, snapshot.photoBase64, { upsert: true });
    requireProfileScope(scope);
  }
  await verifyProfileOwner(scope);
  requireProfileScope(scope);
  const fields = {
    first_name_display: snapshot.name.trim(), profile_photo_url: photoUrl,
    handle: normalizeProfileHandle(snapshot.handle) || null,
    neighborhood: snapshot.neighborhood.trim() || null,
    is_visitor: snapshot.isVisitor, fun_fact: snapshot.funFact.trim() || null,
  };
  const { error, count } = await supabase.from('profiles').update(fields, { count: 'exact' }).eq('id', scope.userId);
  requireProfileScope(scope);
  if (error) throw error;
  if (count !== 1) throw new Error('We couldn’t confirm your changes. Please try again.');
  return fields;
}

/** Keep the existing deletion sequence owned by its authenticated account once
 * the destructive RPC has dispatched. A view closing is not a cancellation of
 * that server operation. This short-lived observer outlives that view only
 * until the operation settles; an account replacement permanently retires it.
 */
export async function deleteOwnProfile(scope: ProfileOperationScope, onConfirmed: () => void) {
  requireProfileScope(scope);
  let replaced = false, signedOut = false;
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    const id = session?.user.id;
    if (!id) { signedOut = true; return; }
    if (id !== scope.userId || signedOut) replaced = true;
  });
  const beforeDispatch = { userId: scope.userId, isCurrent: () => !replaced && scope.isCurrent() };
  const requireOriginalAccount = () => { if (replaced) throw new ObsoleteProfileOperationError(); };
  try {
    await verifyProfileOwner(beforeDispatch);
    const { data: { session }, error: sessionError } = await supabase.auth.refreshSession();
    requireProfileScope(beforeDispatch);
    if (sessionError || !session?.user) throw new Error(sessionError?.message ?? 'Not authenticated');
    if (session.user.id !== scope.userId) throw new ObsoleteProfileOperationError();
    const { error: rpcError } = await supabase.rpc('delete_own_account');
    requireOriginalAccount();
    if (rpcError) throw rpcError;
    // The original fallback uses this account's captured token. Deletion may
    // itself sign the account out, so a null session is not a replacement.
    if (session.access_token) {
      try { await supabase.functions.invoke('delete-user', { headers: { Authorization: `Bearer ${session.access_token}` } }); }
      catch { /* The RPC may already have deleted this account. */ }
      requireOriginalAccount();
    }
    onConfirmed();
    requireOriginalAccount();
    try { await supabase.auth.signOut(); } catch { /* The deleted account's session can already be invalid. */ }
  } finally { subscription.unsubscribe(); }
}
