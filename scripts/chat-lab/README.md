# Local multi-client chat lab

This lab tests real Auth, PostgreSQL, PostgREST and Realtime using two independent
member sessions and a third unrelated session. It uses the application's receipt,
pending-message merge and deferred-subscription helpers. It does not launch the
app UI, replay the full production schema, or measure native performance.

## Boundaries

- Run only against a newly created, disposable local database. Never link this
  directory to a Supabase project or run application migrations here.
- `schema.sql` refuses a database containing public tables. Its policy fixture
  comes from `supabase/tests/contracts/190_topic_notifications_fixture.sql`;
  this is not verification of the current production policy configuration.
- `run.mjs` requires an explicit `http://127.0.0.1:<port>` endpoint, restricts
  HTTP/WebSocket traffic to that endpoint, rejects redirects, and verifies the
  fixture marker before creating fictional accounts or data.
- No SMS, push, external email, storage or application notification functions
  are used. Local service credentials must stay outside Git with mode `600`.
- Stop the lab afterward. A loopback API does not imply every internal service
  listens only on loopback; do not expose this disposable runtime to a network.

## Reproduce

The October 7 run used Node 24.19 (for TypeScript stripping), the installed
Supabase JS 2.97 SDK and its installed `ws` dependency, and official Supabase CLI
2.120.0 on Apple silicon. No app dependency or native configuration changed.
Node's built-in WebSocket did not establish the initial test streams in this
setup; the existing `ws` implementation did. This is a lab transport choice,
not evidence of a React Native transport failure.

Supabase documents its experimental [native local runtime](https://supabase.com/docs/guides/local-development/docker-and-native-runtimes)
and [isolated local projects](https://supabase.com/docs/guides/local-development/running-multiple-local-projects).
Use an official CLI release and verify its download digest. Create a separate
directory outside the application repository with `supabase/config.toml`:

```toml
project_id = "washedup-chat-local-lab"
[experimental]
stack = true
[auth]
site_url = "http://127.0.0.1:8847"
[auth.email]
enable_signup = true
enable_confirmations = false
[auth.sms]
enable_signup = false
```

From that directory, with the CLI available as `./bin/supabase`:

```sh
export SUPABASE_HOME="$PWD/runtime"
export SUPABASE_EXPERIMENTAL_STACK=1
umask 077
./bin/supabase stack start --runtime native --stack chat-check \
  --exclude storage,functions,studio,mail,analytics,pooler --eager > start.log 2>&1
./bin/supabase status --env > local.env
```

Parse the generated local status privately into `connection.json`, retaining
`API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`, and `DB_URL`; do not paste credentials
into documentation or logs. Check both API and database endpoints are local.
Using the runtime's bundled `psql`, execute `schema.sql` with `-X -v
ON_ERROR_STOP=1 -f <absolute-schema-path>` against that local database only.
The native runtime used here required `sslmode=disable` on the local DB URL.
Apply the fixture once; subsequent test runs create fresh UUID namespaces.

From the application worktree, with its existing dependencies available:

```sh
node scripts/chat-lab/run.mjs /absolute/private/connection.json /absolute/report.json
```

For a larger bounded reconnect run, prefix the command with
`CHAT_LAB_RECONNECT_CYCLES=60` (allowed range 1–100; default 6). The expected
message total becomes `66 + 2 * cycles`. This stresses repeated socket teardown
and recovery; it is not a days-long soak or an OS suspension simulation.

The harness checks both-way delivery, Unicode, a 40-message concurrent burst,
lost-response recovery, same-ID retry deduplication, 20-message missed-history
recovery, six reconnect cycles, outsider access denial, sender impersonation
denial, and archived-topic send denial. It also checks twenty shared-name typing
broadcast reconnects, with both-way delivery and at least one observed SDK
socket-close window. Those ephemeral broadcasts do not add message rows.
The successful default final history has 78
distinct messages. Recorded local round trips are diagnostics, not a latency
benchmark. History recovery is explicitly driven by the harness; separate hook
tests verify the app's refresh ownership.

From the external lab directory, stop only this lab and preserve its data:

```sh
./bin/supabase stack stop --stack chat-check
```

The original local run and evidence are under
`/Users/liz/Desktop/WashedUp_HQ/chat-verification-20261007/`.
This lab replaces the need for two physical phones for these transport checks.
It does not replace physical-device checks for keyboard input, scrolling,
background delivery, push, cold starts, or Build 51 native compatibility.

## Private DM blocking follow-up

`private-block-schema.sql` adds a synthetic DM/group fixture only to the marked
local chat lab above and refuses to replace an existing `messages` table. Using
that same verified loopback database, apply this add-on, the canonical
`yours_is_blocked_between` definition from `20260517000100_yours_helpers.sql`,
and the review-only `20261007120000_private_chat_block_boundary.sql`. Reload the
local PostgREST schema. Never apply application migrations wholesale to this lab.

Run `node scripts/chat-lab/private-blocks.mjs /private/connection.json /local/report.json`.
The 14 checks keep both authenticated sessions connected across both directions
and both storage forms of a block. They verify denied history/send/reactions,
filtered live message/reaction rows from a privileged synthetic write, continuing
group delivery, restored delivery after unblock, and outsider denial. A delivered
group sentinel plus an 800 ms observation window checks for unexpected DM events;
it is bounded evidence, not a guarantee about every possible network schedule.

The test does not clear messages already held in a UI, test native performance,
or invoke notification providers. RPC behavior is verified separately by the
264-assertion disposable PostgreSQL contract runner. Stop `chat-check` afterward
as above; retain its fictional data for reproducibility.
