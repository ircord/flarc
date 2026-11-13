import { defineEventHandler } from "nitro/h3";
import { selectors, sessionFeature } from "~/features/session/http";
export default defineEventHandler(async (event) =>
  sessionFeature(event, "conversation.unread", selectors(event)),
);
