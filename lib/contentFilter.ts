/**
 * Lightweight content filter for UGC screening.
 *
 * Apple Guideline 1.2 requires "a method to filter objectionable material."
 * This catches obvious profanity/slurs before content is submitted.
 * Not exhaustive — meant as a first line of defense alongside human moderation.
 *
 * To add words: append to the BLOCKED_TERMS array.
 * To whitelist false positives: add to ALLOWED_TERMS.
 */

const BLOCKED_TERMS = [
  // Slurs & hate speech (highest priority for App Store compliance)
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded',
  'tranny', 'dyke', 'kike', 'spic', 'wetback', 'chink',
  'gook', 'coon', 'beaner', 'towelhead', 'raghead',

  // Common profanity
  'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick',
  'cock', 'pussy', 'whore', 'slut',

  // Threats & violence
  'kill yourself', 'kys', 'kill you', 'rape',

  // Sexual content
  'porn', 'hentai', 'onlyfans', 'nudes', 'nude pics',
];

const ALLOWED_TERMS = [
  'assistant', 'class', 'cocktail', 'cockatoo', 'scunthorpe',
  'dickens', 'hancock', 'sussex', 'therapist', 'analyze',
  'shitake', 'peacock',
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0@]/g, 'o')
    .replace(/1|!/g, 'i')
    .replace(/3/g, 'e')
    .replace(/\$/g, 's')
    .replace(/5/g, 's')
    .replace(/\+/g, 't')
    .replace(/[*_\-.]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isAllowed(original: string): boolean {
  const lowerOriginal = original.toLowerCase();
  return ALLOWED_TERMS.some((allowed) => lowerOriginal.includes(allowed));
}

export function checkContent(text: string): { ok: boolean; reason?: string } {
  if (!text || text.trim().length === 0) return { ok: true };

  const normalized = normalize(text);

  for (const term of BLOCKED_TERMS) {
    const normalizedTerm = normalize(term);
    const regex = new RegExp(`\\b${normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');

    if (regex.test(normalized) && !isAllowed(text)) {
      return {
        ok: false,
        reason: 'Your message contains language that goes against our community guidelines.',
      };
    }
  }

  return { ok: true };
}

export function isContentClean(text: string): boolean {
  return checkContent(text).ok;
}
