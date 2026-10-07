# Saved device-subscription ownership contract — September 13

Read-only source audit. This describes saved code, not verification of deployed policies or account settings.

`20260501000002_create_device_tokens.sql` makes `onesignal_player_id` globally unique. SELECT, UPDATE and DELETE are restricted to the owning `auth.uid()`; INSERT and UPDATE require the row's resulting owner to be that authenticated user. The client registration helper upserts by the subscription ID. Therefore, if account A already owns an ID and the same installation later logs into B, B's upsert can conflict with A's row and be rejected by the owner-only policy. The local SDK lifetime repair does not solve that server ownership conflict.

Both the queued sender and the plan-posted notification path use the saved device token mapping to select recipients. A verified transition must therefore cover registration, sign-out/account switching and fanout together. Permitting clients to reassign arbitrary submitted subscription IDs would create a new cross-account access problem; do not relax RLS to make the upsert pass.

The installed React Native OneSignal declaration only exposes `login(externalId: string)`. OneSignal's current [identity verification documentation](https://documentation.onesignal.com/docs/en/identity-verification) describes server-issued JWTs, but lists React Native wrapper support as coming soon. This does not establish the WashedUp account's current configuration. Do not enable a provider setting that the installed client cannot satisfy.

Next implementation must establish a supported, verified device-to-account ownership contract, then rehearse it against a disposable database with both accounts, sign-out, duplicate retry and fanout checks. Preserve room/source eligibility and mute policy. Record the actual deployed definitions before drafting a production migration. No SQL, provider settings, credentials or recipient data was changed by this audit.
