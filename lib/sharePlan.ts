/**
 * Builds the share content for a plan. `message` is the human-readable label
 * (title + date + venue), `url` is the deep-linkable URL. The caller passes
 * both to React Native's Share.share — keeping the URL out of `message` avoids
 * the URL being rendered twice on iOS apps that concatenate both fields
 * (e.g. WhatsApp shows message+url back-to-back).
 */
interface SharePlanInput {
  id: string;
  title: string;
  start_time: string;
  location_text?: string | null;
  slug?: string | null;
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

  const message = parts.join(' · ');
  const url = getPlanShareUrl(plan);

  return { message, url };
}

export function getPlanShareUrl(plan: { id: string; slug?: string | null }): string {
  if (plan.slug) return `https://washedup.app/plans/${plan.slug}`;
  return `https://washedup.app/e/${plan.id}`;
}
