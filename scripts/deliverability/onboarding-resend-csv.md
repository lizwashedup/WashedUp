# Required onboarding email and Resend CSV

Native and web onboarding already require a valid email, persist it in profiles.email, and enqueue the existing audience reconciliation. Phone registration must not cause exports to use only auth.users.email. Marketing consent remains independent.

Offline export preparation (no credentials, database queries, uploads or sends):

```sh
python3 scripts/deliverability/export-onboarding-resend.py --profiles /path/to/current-profiles.csv --existing-resend /path/to/current-resend.csv --output /path/to/new-washedup-resend.csv
```

Profiles input needs email and marketing_opt_in; optional first_name_display and last_name are included. Existing Resend input is optional and needs email and unsubscribed. Supply the current provider export before a live import so prior provider opt-outs are preserved. Archived email-only lists cannot establish consent. New output only; existing files are never overwritten. Output permissions600, counters only in logs. Input freshness, provider suppressions and approved production export/import remain operational prerequisites. This utility does not automatically update a CSV after each signup; the existing outbox is the continuous sync path.

CSV fields email,first_name,last_name,unsubscribed follow Resend's supported contact fields: https://resend.com/blog/manage-subscribers-using-resend-audiences . Opt-outs remain included with unsubscribed=true. Conflicting duplicate emails use opt-out. Seven synthetic tests pass; no real contact rows were read or altered during this work.
