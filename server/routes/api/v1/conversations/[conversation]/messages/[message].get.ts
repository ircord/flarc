import { defineEventHandler, getRouterParam } from "nitro/h3";
import { selectors, sessionFeature } from "~/features/session/http";
export default defineEventHandler(async (event) =>
  sessionFeature(event, "conversation.message", {
    ...selectors(event),
    messageId: getRouterParam(event, "message", { decode: true }),
  }),
);
