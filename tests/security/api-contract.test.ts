import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateOpenAPISpec } from "~/routes/openapi.json.get";

function routes(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? routes(path.join(directory, entry.name))
      : [path.join(directory, entry.name)],
  );
}

describe("API documentation matches the authenticated implementation", () => {
  it("documents every client file route and its actual method, including aliases", () => {
    const spec = generateOpenAPISpec();
    for (const file of routes("server/routes/api")) {
      if (file.includes("[...slug]")) continue; // Administrator concrete paths are separately documented.
      const match = file.match(/\.(get|post|put|patch|delete)\.ts$/);
      if (!match) continue;
      const route = `/${file
        .replace(/^server\/routes\//, "")
        .replace(/\.(get|post|put|patch|delete)\.ts$/, "")
        .replace(/\/index$/, "")
        .replace(/\[([^\]]+)\]/g, "{$1}")}`;
      expect(spec.paths[route]?.[match[1]], `${match[1]} ${route}`).toBeDefined();
    }
  });
  it("uses account sessions, excludes public role assignment, and documents real login/ticket responses", () => {
    const spec = generateOpenAPISpec();
    expect(spec.security).toEqual([{ SessionToken: [] }]);
    expect(spec.components.securitySchemes).not.toHaveProperty("BasicAuth");
    expect(spec.components.schemas.RegisterRequest.properties).not.toHaveProperty("roles");
    expect(spec.components.schemas.SendMessage.properties.content.pattern).toBe("^[^\\x00]*$");
    expect(
      spec.paths["/api/v1/auth/login"].post.responses["200"].content["application/json"].schema
        .properties,
    ).toHaveProperty("token");
    expect(
      spec.paths["/api/v1/auth/events-ticket"].post.responses["200"].content["application/json"]
        .schema.properties.expiresIn.const,
    ).toBe(30);
    expect(spec.paths["/api/v1/events"].get.responses["101"]).toBeDefined();
    expect(spec.paths["/api/v1/admin/accounts/register"]).not.toHaveProperty("get");
  });
});
