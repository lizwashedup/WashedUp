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

The harness checks both-way delivery, Unicode, a 40-message concurrent burst,
lost-response recovery, same-ID retry deduplication, 20-message missed-history
recovery, six reconnect cycles, outsider access denial, sender impersonation
denial, and archived-topic send denial. The successful final history has 78
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
