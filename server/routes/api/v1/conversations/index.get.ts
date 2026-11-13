import { defineEventHandler, getQuery } from "nitro/h3";
import { sessionFeature } from "~/features/session/http";
export default defineEventHandler(async (event) =>
  sessionFeature(event, "conversations.list", getQuery(event)),
);
