import { defineEventHandler, getRouterParam } from "nitro/h3";
import { sessionFeature } from "~/features/session/http";
export default defineEventHandler(async (event) =>
  sessionFeature(event, "metadata.get", {
    target: getRouterParam(event, "target", { decode: true }),
  }),
);
