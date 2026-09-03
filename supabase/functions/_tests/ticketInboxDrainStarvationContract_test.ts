// AC-EML-004 ("...progresses toward success or an alert without starving
// newer deliveries") automated gap. ticket-inbox-drain/index.ts is the
// other function verify-75-threshold.sh pins to an exact reviewed SHA256
// (EXPECTED_TICKET_DRAIN_SHA) -- frozen pending Josh's deploy word, same
// reasoning as ticketResendReceiptContract_test.ts next to this file: never
// import or edit it, only read its own source text and check the numbers it
// already contains actually satisfy the non-starvation property its
// comments claim, the same static-source-contract technique
// lib/__tests__/creatorShellRedirects.test.ts already uses on a frozen file.
//
// confirmationRetry_test.ts (existing) already proves the bounded-single-
// provider-call and stable-idempotency-key halves of AC-EML-003/004. This
// file proves the one remaining piece those tests don't touch: the drain
// loop's own batch-slot reservation, which is what actually keeps a run of
// stuck confirmation-retry rows from crowding out fresh Stripe webhook
// events (or vice versa) in the same invocation.

const SOURCE_PATH = new URL('../ticket-inbox-drain/index.ts', import.meta.url);
const source = Deno.readTextFileSync(SOURCE_PATH);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function extractConst(name: string): number {
  const match = source.match(new RegExp(`const ${name}\\s*=\\s*(\\d+)`));
  assert(match, `expected to find "const ${name} = <number>" in ticket-inbox-drain/index.ts`);
  return Number(match![1]);
}

Deno.test('ticket-inbox-drain: batch-slot constants are still present under their expected names', () => {
  assert(source.includes('const BATCH_SIZE = 20'), 'BATCH_SIZE moved or changed shape');
  assert(source.includes('const CONFIRMATION_BATCH_SIZE = 2'), 'CONFIRMATION_BATCH_SIZE moved or changed shape');
  assert(source.includes('const EVENT_RETRY_SLOTS = 2'), 'EVENT_RETRY_SLOTS moved or changed shape');
});

Deno.test('ticket-inbox-drain: a full run of stuck EVENT retries can never claim every event slot', () => {
  const batchSize = extractConst('BATCH_SIZE');
  const confirmationBatchSize = extractConst('CONFIRMATION_BATCH_SIZE');
  const eventRetrySlots = extractConst('EVENT_RETRY_SLOTS');
  const eventSlots = batchSize - confirmationBatchSize;
  assert(
    eventRetrySlots < eventSlots,
    `EVENT_RETRY_SLOTS (${eventRetrySlots}) must stay below the total event lane (${eventSlots}) so a run full of ` +
      'retryable events still leaves room for at least one fresh event, every invocation',
  );
});

Deno.test('ticket-inbox-drain: a full run of stuck CONFIRMATION retries can never claim every confirmation slot', () => {
  const confirmationBatchSize = extractConst('CONFIRMATION_BATCH_SIZE');
  const confirmationRetryLimitMatch = source.match(
    /confirmationRetries[\s\S]{0,400}?\.limit\((\d+)\)/,
  );
  assert(confirmationRetryLimitMatch, 'expected to find the confirmation-retry query\'s own .limit(N)');
  const confirmationRetrySlots = Number(confirmationRetryLimitMatch![1]);
  assert(
    confirmationRetrySlots < confirmationBatchSize,
    `the confirmation-retry slot (${confirmationRetrySlots}) must stay below CONFIRMATION_BATCH_SIZE ` +
      `(${confirmationBatchSize}) so a run full of stuck confirmation retries still leaves room for at least one ` +
      'fresh confirmation, every invocation',
  );
});

Deno.test('ticket-inbox-drain: the claim-before-work guard still exists (retries never bypass the poison cap)', () => {
  assert(source.includes('const MAX_ATTEMPTS = 60;'), 'the durable poison cap constant moved or changed value');
  assert(
    source.includes('if (claimedAttempts > MAX_ATTEMPTS) {'),
    'the poison-cap check must still run on the CLAIMED attempt count, after the optimistic claim, never before it',
  );
});
