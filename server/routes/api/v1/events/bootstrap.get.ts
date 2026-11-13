import { defineEventHandler, getQuery } from "nitro/h3";
import { sessionFeature } from "~/features/session/http";
export default defineEventHandler((event) =>
  sessionFeature(event, "events.bootstrap", getQuery(event)),
);
