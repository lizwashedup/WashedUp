import { planCreatorBroadcast, type BroadcastChannel } from '../notifications/creatorBroadcastPlan';

const activation = (active: BroadcastChannel[]) => ({
  in_app: active.includes('in_app'),
  push: active.includes('push'),
  email: active.includes('email'),
  sms: active.includes('sms'),
});

describe('creator broadcast delivery foundation', () => {
  it('plans one job per active, unmuted, consenting recipient and never returns addresses', () => {
    const jobs = planCreatorBroadcast('broadcast-1', 'sender', [
      { userId: 'sender', active: true, muted: false, consent: { in_app: true } },
      { userId: 'member-b', active: true, muted: false, consent: { in_app: true, push: true } },
      { userId: 'member-a', active: true, muted: false, consent: { in_app: true, push: false } },
      { userId: 'muted', active: true, muted: true, consent: { in_app: true } },
      { userId: 'inactive', active: false, muted: false, consent: { in_app: true } },
    ], ['push', 'in_app', 'push'], activation(['in_app', 'push']));

    expect(jobs).toEqual([
      { recipientUserId: 'member-a', channel: 'in_app', idempotencyKey: 'broadcast-1:member-a:in_app' },
      { recipientUserId: 'member-b', channel: 'in_app', idempotencyKey: 'broadcast-1:member-b:in_app' },
      { recipientUserId: 'member-b', channel: 'push', idempotencyKey: 'broadcast-1:member-b:push' },
    ]);
    expect(JSON.stringify(jobs)).not.toMatch(/email|phone|address/);
  });

  it('keeps every external channel empty while activation is off', () => {
    const jobs = planCreatorBroadcast('broadcast-1', 'sender', [
      {
        userId: 'member', active: true, muted: false,
        consent: { in_app: true, push: true, email: true, sms: true },
      },
    ], ['in_app', 'push', 'email', 'sms'], activation(['in_app']));
    expect(jobs.map((job) => job.channel)).toEqual(['in_app']);
  });
});
