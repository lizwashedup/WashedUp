/**
 * Builds the share content for a plan. The URL goes in both `message` and
 * `url` so receiving apps that read only `message` (WhatsApp, iMessage) still
 * get a clickable link, while apps that read `url` (Mail, AirDrop) still get
 * a rich preview. URL is on its own line so messengers render it as a link.
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

  const firstLine = parts.join(' · ');
  const url = getPlanShareUrl(plan);
  const message = `${firstLine}\n${url}`;

  return { message, url };
}

export function getPlanShareUrl(plan: { id: string; slug?: string | null }): string {
  if (plan.slug) return `https://washedup.app/plans/${plan.slug}`;
  return `https://washedup.app/e/${plan.id}`;
}
