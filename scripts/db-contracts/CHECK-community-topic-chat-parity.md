# Run this in Supabase, SQL editor, then tell Claude the result

```sql
select column_name from information_schema.columns
where table_name = 'community_topic_messages'
and column_name in ('image_url','reply_to_message_id','edited_at');
```

**3 rows back** = chat upgrade is already live in production.
**0 rows back** = it still needs to be turned on for real.

That's it. That's the only thing needed to close out chat.
