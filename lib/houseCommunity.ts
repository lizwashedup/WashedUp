/**
 * The WashedUp Contributor Community: the first-party exception.
 *
 * SPEC ME (design-pass item, doc 13): the full special treatment is still
 * Liz's to shape. What is decided so far:
 *   - It is a real community in the same tables, no parallel system.
 *   - Liz operates it WITHOUT the normal grant flow: it gets created by an
 *     admin (create_community as Liz, or straight SQL) and her leader
 *     membership row is seeded the same way. No schema needed; the grant
 *     check gates who can CREATE communities, not who can lead a seeded one.
 *   - Its handle is reserved here so nothing else can wear it, and every
 *     surface that shows a community card or page checks isHouseCommunity
 *     to add the house mark.
 *   - Patreon-style give-to-join arrives with the payments phase (doc 05);
 *     until then it behaves as a normal free community.
 * Open for the design pass: the mark's final look, the page treatment, the
 * membership perks copy, whether it is pinned first in discovery.
 */

export const HOUSE_COMMUNITY_HANDLES = ['washedup', 'contributors'] as const;

export function isHouseCommunity(handle: string | null | undefined): boolean {
  if (!handle) return false;
  return (HOUSE_COMMUNITY_HANDLES as readonly string[]).includes(handle.toLowerCase());
}

// LIZ COPY: the words on the house mark
export const HOUSE_MARK_LABEL = 'the house community';
