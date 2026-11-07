import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';

/** A preference write belongs to this member and chat even if its screen closes. */
export function useChatMuteWrite(kind: string, roomId: string | undefined, userId: string | null | undefined) {
  const client = useQueryClient();
  const prefix = [kind, roomId, userId] as const;
  const mutationKey = ['write-chat-mute', ...prefix];
  const filter = { mutationKey, exact: true };
  const busy = useIsMutating(filter) > 0;
  const mutation = useMutation({
    mutationKey, retry: false, gcTime: 0, networkMode: 'always',
    mutationFn: (run: () => Promise<void>) => run(),
  });
  type Outcome = { value: boolean | null; matched: boolean } | undefined;
  async function run(change: () => Promise<Outcome>, isCurrent: () => boolean) {
    if (client.isMutating(filter)) return;
    let result: Outcome;
    await mutation.mutateAsync(async () => {
      try { result = await change(); }
      finally {
        // A retired or unsuccessful readback cannot establish the saved value.
        // Discard the pre-write snapshot for this member/room only.
        if (!isCurrent() || result?.value == null) await client.resetQueries({ queryKey: prefix });
      }
    });
    return result;
  }
  return { busy, run };
}
