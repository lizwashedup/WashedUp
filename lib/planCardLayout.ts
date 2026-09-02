export const MAX_ACTIVITY_FIRST_COMPANIONS = 2;

type AttendeePhoto = { profile_photo_url: string | null };

/**
 * Builds the small, deliberately quiet companion stack for the activity-first
 * card. Real attendee photos are used when the caller already has them. Empty
 * slots stay as neutral circles, so the feed does not need another data query.
 */
export function getActivityFirstCompanionPhotos(
  attendees: AttendeePhoto[] | undefined,
  memberCount: number,
  creatorPhotoUrl: string | null,
): Array<string | null> {
  const companionCount = Math.min(
    MAX_ACTIVITY_FIRST_COMPANIONS,
    Math.max(0, memberCount - 1),
  );

  const distinctPhotos = Array.from(
    new Set(
      (attendees ?? [])
        .map((attendee) => attendee.profile_photo_url)
        .filter((url): url is string => Boolean(url) && url !== creatorPhotoUrl),
    ),
  );

  return Array.from(
    { length: companionCount },
    (_, index) => distinctPhotos[index] ?? null,
  );
}
