interface PeopleNotice { id: string; user_id: string; type: string }

/** Recovered requests must still be pending and unblocked before dispatch. */
export async function peopleRequestPushIsEligible(database: {
  from: (table: string) => any;
  rpc: (name: string, args: any) => PromiseLike<any>;
}, notice: PeopleNotice): Promise<boolean> {
  if (notice.type !== 'people_request') return true;
  const { data: rows, error } = await database.from('app_notifications')
    .select('id,user_id,type,actor_user_id,created_at').eq('id', notice.id);
  if (error || !Array.isArray(rows) || rows.length !== 1) {
    throw new Error('People request notification could not be confirmed');
  }
  const row = rows[0];
  if (row.id !== notice.id || row.user_id !== notice.user_id || row.type !== notice.type) {
    throw new Error('People request notification did not match');
  }
  if (row.actor_user_id === null) return false;
  if (typeof row.actor_user_id !== 'string' || !row.actor_user_id
      || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) {
    throw new Error('People request identity could not be confirmed');
  }
  const { data: connections, error: connectionError } = await database.from('people_connections')
    .select('requester_user_id,recipient_user_id,status,requested_at')
    .eq('requester_user_id', row.actor_user_id).eq('recipient_user_id', row.user_id);
  if (connectionError || !Array.isArray(connections) || connections.length > 1) {
    throw new Error('People request status could not be confirmed');
  }
  if (connections.length === 0) return false;
  const connection = connections[0];
  if (connection.requester_user_id !== row.actor_user_id || connection.recipient_user_id !== row.user_id
      || !['pending', 'accepted', 'declined', 'removed'].includes(connection.status)
      || typeof connection.requested_at !== 'string' || !Number.isFinite(Date.parse(connection.requested_at))) {
    throw new Error('People request status did not match');
  }
  // A newer re-request has its own notice; do not replay the older one.
  if (connection.status !== 'pending' || Date.parse(connection.requested_at) > Date.parse(row.created_at)) return false;
  const { data: blocked, error: blockError } = await database.rpc('yours_is_blocked_between', {
    p_a: row.user_id, p_b: row.actor_user_id,
  });
  if (blockError || typeof blocked !== 'boolean') throw new Error('People request block status could not be confirmed');
  return !blocked;
}
