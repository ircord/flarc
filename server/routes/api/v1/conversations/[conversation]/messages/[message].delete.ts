import { defineEventHandler, getRouterParam } from "nitro/h3";
import { mutation, selectors, sessionFeature } from "~/features/session/http";
export default defineEventHandler(async (event) =>
  sessionFeature(event, "conversation.redact", {
    ...(await mutation(event)),
    conversationId: selectors(event).conversationId,
    messageId: getRouterParam(event, "message", { decode: true }),
  }),
);
