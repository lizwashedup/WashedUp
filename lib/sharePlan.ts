/**
 * Builds the share content for a plan.
 * Returns separate message and url — iOS surfaces the url as a rich link
 * preview in the share sheet. Android's Share API silently drops the url
 * field, so we bake it into the message there.
 */
import { Platform } from 'react-native';

interface SharePlanInput {
  id: string;
  title: string;
  start_time: string;
  location_text?: string | null;
  slug?: string | null;
  member_count: number;
  max_invites: number | null;
}

export function buildPlanShareContent(plan: SharePlanInput): { message: string; url: string } {
  const parts: string[] = [plan.title];

  if (plan.start_time) {
    const d = new Date(plan.start_time);
    const dateStr = d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const timeStr = d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    parts.push(dateStr);
    parts.push(timeStr);
  }

  if (plan.location_text && !plan.location_text.startsWith('http')) {
    const venue = plan.location_text.split(',')[0].trim();
    if (venue) parts.push(venue);
  }

  const firstLine = parts.join(' \u00B7 ');

  const totalCapacity = (plan.max_invites ?? 7) + 1;
  const going = Math.max(1, plan.member_count);
  const spotsLeft = Math.max(0, totalCapacity - going);
  const availabilityText = spotsLeft === 0 ? 'Waitlist open' : `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left`;

  const url = getPlanShareUrl(plan);

  const baseMessage = `${firstLine}\n${availabilityText}`;
  const message =
    Platform.OS === 'android' ? `${baseMessage}\n${url}` : baseMessage;

  return { message, url };
}

export function getPlanShareUrl(plan: { id: string; slug?: string | null }): string {
  if (plan.slug) return `https://washedup.app/plans/${plan.slug}`;
  return `https://washedup.app/plan/${plan.id}`;
}
