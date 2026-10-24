import { deliverMail } from "./mail-delivery";
export { canonicalAccountOrigin } from "./auth-origin";
export {
  emailDeliveryMode,
  accountMailConfigured,
  MailDeliveryError,
  deliverMail,
} from "./mail-delivery";
export type { AccountMail } from "./mail-delivery";
import type { AccountMail } from "./mail-delivery";
export type AccountMailSender = (mail: AccountMail) => Promise<void>;
/** Uncertain sends deliberately do not throw: existing callers retain valid tokens. */
export async function sendAccountMail(mail: AccountMail): Promise<void> {
  const { openCommunityDatabase } = await import("./community");
  await deliverMail(openCommunityDatabase(), mail);
}
