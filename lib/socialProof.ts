/**
 * Social-proof threshold logic (doc 37): a raw count only when it reads
 * as company, never as emptiness. Under the threshold the surfaces show
 * warmth instead of arithmetic — "founding members", "be one of the
 * first" — all LIZ COPY at their call sites.
 */
export const MEMBER_COUNT_THRESHOLD = 5;
