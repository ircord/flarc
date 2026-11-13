import { defineEventHandler, getRouterParam } from "nitro/h3";
import { sessionFeature } from "~/features/session/http";
export default defineEventHandler((event) =>
  sessionFeature(event, "messages.get", {
    messageId: getRouterParam(event, "message", { decode: true }),
  }),
);
