/**
 * buildComposerWithPerson - the deep link to the plan composer with a person
 * pre-attached as a removable invite chip. Used by "Make a plan" from a person
 * (People long-press menu, DM "+" menu) so the composer never opens as the
 * context-free /post dump (the locked auto-attach rule).
 */
export function buildComposerWithPerson(
  userId: string,
  name: string | null,
  photo: string | null,
): string {
  const parts = [`prefillInvitePersonId=${encodeURIComponent(userId)}`];
  if (name && name.trim()) parts.push(`prefillInvitePersonName=${encodeURIComponent(name.trim())}`);
  if (photo) parts.push(`prefillInvitePersonPhoto=${encodeURIComponent(photo)}`);
  return `/(tabs)/post?${parts.join('&')}`;
}
