import { canonicalAccountOrigin } from "./auth-origin";
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function safeEmailActionUrl(value: string): string {
  const u = new URL(value),
    origin = canonicalAccountOrigin();
  const local =
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (
    u.username ||
    u.password ||
    /[\r\n]/.test(value) ||
    (!local && u.protocol !== "https:") ||
    (local && !["http:", "https:"].includes(u.protocol)) ||
    (origin ? u.origin !== origin : !local)
  )
    throw new Error("Invalid email action URL.");
  return u.href;
}
export function renderEmail(input: {
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footer?: string;
  unsubscribeUrl?: string;
}): { html: string; text: string } {
  const url = input.action && safeEmailActionUrl(input.action.url),
    unsubscribe =
      input.unsubscribeUrl && safeEmailActionUrl(input.unsubscribeUrl);
  const text = [
    input.heading,
    ...input.paragraphs,
    ...(input.action ? [`${input.action.label}: ${url}`] : []),
    ...(input.footer ? [input.footer] : []),
    ...(unsubscribe ? [`Unsubscribe: ${unsubscribe}`] : []),
  ].join("\n\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(input.heading)}</title><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media only screen and (max-width:600px){.email-page{padding:16px 12px!important}.email-card{padding:24px 20px!important}.email-heading{font-size:22px!important}}</style></head><body style="margin:0;padding:24px 16px;background-color:#F8FAFC;color:#0F172A;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%"><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;background-color:#F8FAFC"><tr><td class="email-page" align="center" style="padding:24px 16px"><main role="main" aria-label="Reach email" style="width:100%;max-width:600px;margin:0 auto"><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;max-width:600px;border-collapse:separate;border-spacing:0;background-color:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px"><tr><td class="email-card" style="padding:32px;background-color:#FFFFFF;border-radius:12px"><p style="margin:0 0 20px;color:#0F766E;font-size:16px;font-weight:700;line-height:1.4">Reach</p><h1 class="email-heading" style="margin:0 0 20px;color:#0F172A;font-size:24px;font-weight:700;line-height:1.3">${escapeHtml(input.heading)}</h1>${input.paragraphs.map((p) => `<p style="margin:0 0 16px;color:#0F172A;font-size:16px;line-height:1.6">${escapeHtml(p)}</p>`).join("")}${input.action ? `<p style="margin:24px 0 12px"><a rel="noreferrer" style="display:inline-block;min-height:44px;box-sizing:border-box;padding:13px 20px;background-color:#0F766E;color:#FFFFFF;border:1px solid #0F766E;border-radius:6px;font-size:16px;font-weight:700;line-height:1.2;text-align:center;text-decoration:none" href="${escapeHtml(url!)}">${escapeHtml(input.action.label)}</a></p><p style="margin:0 0 20px;color:#334155;font-size:13px;line-height:1.5;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(url!)}</p>` : ""}${input.footer ? `<p style="margin:24px 0 12px;color:#475569;font-size:13px;line-height:1.6">${escapeHtml(input.footer)}</p>` : ""}${unsubscribe ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.5"><a rel="noreferrer" style="color:#0F766E;text-decoration:underline" href="${escapeHtml(unsubscribe)}">Unsubscribe from these emails</a></p>` : ""}</td></tr></table></main></td></tr></table></body></html>`;
  return { html, text };
}
