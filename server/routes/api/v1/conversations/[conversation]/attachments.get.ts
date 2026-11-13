import { defineEventHandler } from "nitro/h3";
import { selectors, sessionFeature } from "~/features/session/http";
export default defineEventHandler((event) =>
  sessionFeature(event, "conversation.attachments", selectors(event)),
);
