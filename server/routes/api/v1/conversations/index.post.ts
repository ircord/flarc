import { defineEventHandler } from "nitro/h3";
import { mutation, sessionFeature } from "~/features/session/http";
export default defineEventHandler(async (event) =>
  sessionFeature(event, "conversations.create", await mutation(event)),
);
