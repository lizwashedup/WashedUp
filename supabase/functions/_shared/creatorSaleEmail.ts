import Colors from "../../../constants/Colors.ts";
import { FontSizes } from "../../../constants/Typography.ts";

type Sale = {
  decision: "deliver";
  email: string;
  eventId: string;
  orderId: string;
  quantity: number;
  title: string;
  idempotencyKey: string;
};
type Decision = Sale | { decision: "pause"; reason: string } | {
  decision: "cancel";
  reason: string;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseCreatorSaleDispatch(
  value: unknown,
  eventId: string,
  userId: string,
): Decision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    (v.decision === "pause" || v.decision === "cancel") &&
    typeof v.reason === "string"
  ) {
    return { decision: v.decision, reason: v.reason.slice(0, 100) };
  }
  if (
    v.decision !== "deliver" || v.eventId !== eventId || !UUID.test(eventId) ||
    !UUID.test(userId) ||
    typeof v.orderId !== "string" || !UUID.test(v.orderId) ||
    typeof v.email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) ||
    typeof v.title !== "string" || !v.title.trim() ||
    !Number.isSafeInteger(v.quantity) || Number(v.quantity) < 1 ||
    v.idempotencyKey !== `creator-sale/${v.orderId}/${userId}`
  ) return null;
  return {
    decision: "deliver",
    eventId,
    orderId: v.orderId,
    email: v.email,
    quantity: Number(v.quantity),
    title: v.title,
    idempotencyKey: String(v.idempotencyKey),
  };
}
function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  )
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
export function renderCreatorSaleEmail(
  sale: Sale,
): { subject: string; html: string; text: string } {
  const title = sale.title.trim();
  const summary = `${sale.quantity} ${
    sale.quantity === 1 ? "ticket has" : "tickets have"
  } been booked.`;
  // Reuse the established event permalink, without buyer identity or financial data.
  const url = `https://washedup.app/e/${encodeURIComponent(sale.eventId)}`;
  const footer =
    "You receive sale alerts because you enabled them for this event. You can turn them off in its settings.";
  return {
    subject: `New ticket order: ${title.replace(/[\r\n]+/g, " ")}`,
    text: ["washedup", title, summary, `View event: ${url}`, footer].join(
      "\n\n",
    ),
    html:
      `<!doctype html><html><body style="margin:0;background:${Colors.parchment};color:${Colors.asphalt};font-family:sans-serif;font-size:${FontSizes.bodyLG}px;"><div style="max-width:560px;margin:0 auto;padding:24px;"><p style="color:${Colors.terracotta};">washedup</p><h1>${
        escape(title)
      }</h1><p>${summary}</p><p><a href="${url}" style="color:${Colors.terracotta};">View event</a></p><p style="font-size:${FontSizes.bodySM}px;">${footer}</p></div></body></html>`,
  };
}
