// AC-EML-005 ("a receipt resend goes only to that buyer's verified account
// email") automated gap. ticket-resend-receipt/index.ts is one of the two
// functions verify-75-threshold.sh pins to an exact reviewed SHA256
// (EXPECTED_TICKET_RESEND_SHA) -- it ships on a frozen, already-reviewed
// bundle pending Josh's deploy word, so this file must never import or edit
// it (importing it would execute its top-level Deno.serve against whatever
// real SUPABASE_URL/SERVICE_ROLE_KEY happen to be in the environment, which
// this repo's Release Discipline rule forbids without an explicit live-test
// go). A static source-contract test -- reading the file's own text and
// asserting the security-relevant lines are present -- is the same pattern
// lib/__tests__/creatorShellRedirects.test.ts already uses on the frozen
// app/(creator)/_layout.tsx: it proves nothing changed the recipient-sourcing
// invariant without touching, executing, or reviewing the file anew.
//
// What this file does NOT prove: that Resend actually delivers, or that a
// real device sees the email. That half stays exactly what it always was --
// real-account, real-inbox proof only a human can give (see AC-EML-002).

const SOURCE_PATH = new URL('../ticket-resend-receipt/index.ts', import.meta.url);
const source = Deno.readTextFileSync(SOURCE_PATH);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('ticket-resend-receipt: request body accepts only order_id, never a caller-supplied email', () => {
  assert(
    source.includes('let body: { order_id?: string };'),
    'the request body type must name order_id as its only field -- an email field here would be a real client-override risk',
  );
});

Deno.test('ticket-resend-receipt: recipient email comes from the verified JWT, not the request body', () => {
  assert(
    source.includes('const callerEmail = userData?.user?.email;'),
    'callerEmail must be read from the auth.getUser() result (the verified JWT), not from parsed body input',
  );
  assert(
    !/body\??\.\s*email/.test(source),
    'the request body must never expose an email field the client could set',
  );
});

Deno.test('ticket-resend-receipt: the provider send targets only the caller\'s own verified email', () => {
  assert(
    source.includes('to: [callerEmail]'),
    'the outbound send must address exactly [callerEmail] -- no other recipient list shape is safe here',
  );
});

Deno.test('ticket-resend-receipt: a resend is refused unless the caller owns the order', () => {
  assert(
    source.includes('if (order.buyer_user_id !== callerId) return json(403'),
    'an authenticated user must never be able to trigger a resend for an order they do not own',
  );
});

Deno.test('ticket-resend-receipt: an account with no verified email is refused, never silently sent elsewhere', () => {
  assert(
    source.includes("if (!callerEmail) return json(409"),
    'a caller with no verified email must be refused, not routed to a fallback address',
  );
});
