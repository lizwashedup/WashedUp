/**
 * How a circle renders, given that DMs are unnamed (name = '') 2-person circles.
 *
 *   named circle      -> its name
 *   unnamed, 2 people -> a DM: the OTHER person's name (+ their face)
 *   unnamed, 3+ people -> a grown DM, now an unnamed circle: the other members' names
 *
 * Used by the circle chat header, the Chats list rows, and the directory filter
 * so "DM vs circle" is decided in exactly one place.
 */
export interface DisplayMember {
  user_id: string;
  name: string | null;
  avatar_url: string | null;
}

export interface CircleDisplay {
  title: string;
  isDm: boolean;
  /** The counterpart's id (DM only) -> their keep page / "View {name}". */
  otherUserId: string | null;
  /** The counterpart's avatar (DM only) -> the list row shows their face. */
  otherAvatar: string | null;
}

export function circleDisplay(
  name: string | null,
  members: DisplayMember[],
  myUserId: string | null,
): CircleDisplay {
  const trimmed = (name ?? '').trim();
  if (trimmed) {
    return { title: trimmed, isDm: false, otherUserId: null, otherAvatar: null };
  }

  const others = members.filter((m) => m.user_id !== myUserId);

  // A 1:1 DM: render the counterpart.
  if (others.length === 1) {
    const o = others[0];
    return { title: o.name ?? 'Someone', isDm: true, otherUserId: o.user_id, otherAvatar: o.avatar_url };
  }

  // A grown DM (unnamed circle): list the other members' names.
  const names = others.map((o) => o.name ?? 'Someone');
  return {
    title: names.length ? names.join(', ') : 'New circle',
    isDm: false,
    otherUserId: null,
    otherAvatar: null,
  };
}

/** A DM is an unnamed circle with exactly two people (used to keep DMs out of
 *  the Yours > Circles directory, where only real circles belong). */
export function isDmCircle(name: string | null, memberCount: number): boolean {
  return (name ?? '').trim() === '' && memberCount === 2;
}
