import { z } from "zod";
import {
  accessFailure,
  privateResponse,
  readPrivateJson,
  requireSameOrigin,
} from "./access-http";
import { interpretNavigationNeeds } from "./navigation-needs-agent";
import { getAIServiceStatus } from "./ai-config";
import { localFoodIntent, rejectedFoodModes } from "./simple-food";
import { AccountError } from "./account-store";

const schema = z
  .object({
    message: z.string().trim().min(1).max(1200),
    useAI: z.boolean().default(false),
  })
  .strict();
/** Bounded interpretation only. No coordinates, new pantry records, or prose
 * from a model can enter the result set. Existing AI privacy/free-tier limits apply. */
export function createFoodSearchHandler(
  deps: {
    interpret?: typeof interpretNavigationNeeds;
    status?: typeof getAIServiceStatus;
  } = {},
) {
  let start = 0,
    count = 0;
  return async (request: Request) => {
    try {
      requireSameOrigin(request);
      const body = await readPrivateJson(request, schema, 6000);
      if (Date.now() - start > 60_000) {
        start = Date.now();
        count = 0;
      }
      if (++count > 20)
        throw new AccountError(
          429,
          "Please wait a moment. You can still browse food options below.",
        );
      const local = localFoodIntent(body.message);
      if (!body.useAI)
        return privateResponse({
          assistance: "directory",
          intent: local,
          aiMessage: "AI is turned off for this search.",
        });
      const service = (deps.status ?? getAIServiceStatus)();
      if (service.state !== "configured")
        return privateResponse({
          assistance: "directory",
          intent: local,
          aiMessage: service.message,
        });
      let aiMessage =
        "AI could not finish this request. You can still use the pantry results.";
      try {
        const result = await (deps.interpret ?? interpretNavigationNeeds)(
          body.message,
          { signal: request.signal },
        );
        if (result.status === "available" && result.assistance === "ai") {
          return privateResponse({
            assistance: "ai",
            intent: {
              ...local,
              ...(local.service === "food" && result.needs?.service
                ? { service: result.needs.service }
                : {}),
              ...(local.mode
                ? {}
                : result.patch?.mode &&
                    !rejectedFoodModes(body.message).includes(result.patch.mode)
                  ? { mode: result.patch.mode }
                  : {}),
            },
          });
        }
        if (result.status === "unavailable") aiMessage = result.message;
      } catch {
        /* Directory matching remains usable after any provider failure. */
      }
      return privateResponse({
        assistance: "directory",
        intent: local,
        aiMessage,
      });
    } catch (error) {
      return accessFailure(error);
    }
  };
}
