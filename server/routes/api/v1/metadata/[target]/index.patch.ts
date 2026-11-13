import { defineEventHandler, getRouterParam } from "nitro/h3";
import { mutation, sessionFeature } from "~/features/session/http";
export default defineEventHandler(async (event) =>
  sessionFeature(event, "metadata.update", {
    ...(await mutation(event)),
    target: getRouterParam(event, "target", { decode: true }),
  }),
);
