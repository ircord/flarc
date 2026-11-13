import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { loadAllowlistConfig } from "../../scripts/allowlist-config.mjs";
import { allowedOutboundUrl } from "../../server/services/outbound";
import { outboundHosts, parseOutboundAllowlist } from "../../shared/outbound-policy.mjs";

it("strict YAML separates outbound purposes and overrides legacy grants without wildcard matching", () => {
  const yaml =
    "version: 1\nembeds: [Preview.Example.com, preview.example.com]\nwebhooks: [hooks.example.com]\npush: [push.example.com]\n";
  expect(parseOutboundAllowlist(yaml)).toEqual({
    version: 1,
    embeds: ["preview.example.com"],
    webhooks: ["hooks.example.com"],
    push: ["push.example.com"],
  });
  const env = { ALLOWLIST_YAML: yaml, EMBED_ALLOWED_HOSTS: "legacy.example.com" };
  expect(outboundHosts(env, "webhooks")).toEqual(["hooks.example.com"]);
  expect(outboundHosts(env, "push")).toEqual(["push.example.com"]);
  for (const target of [
    "https://legacy.example.com",
    "https://sub.preview.example.com",
    "https://hooks.example.com",
    "https://preview.example.com@evil.example.com",
    "http://preview.example.com",
  ])
    expect(allowedOutboundUrl(target, outboundHosts(env, "embeds"))).toBeNull();
  expect(
    allowedOutboundUrl("https://preview.example.com/path", outboundHosts(env, "embeds"))?.hostname,
  ).toBe("preview.example.com");
});

it("malformed or unsafe explicit YAML fails closed instead of restoring legacy or cached permissions", () => {
  const valid = "version: 1\nembeds: [preview.example.com]\n";
  expect(outboundHosts({ ALLOWLIST_YAML: valid }, "embeds")).toEqual(["preview.example.com"]);
  const invalid = [
    "",
    "version: 2",
    "version: 1\nembed: [preview.example.com]",
    "version: 1\nembeds: []\nembeds: [preview.example.com]",
    "version: 1\nembeds: &list [preview.example.com]\nwebhooks: *list",
    "version: 1\nembeds: !!unknown [preview.example.com]",
    "version: 1\nembeds: preview.example.com",
    "version: 1\nembeds: [null]",
    "x".repeat(65537),
  ];
  for (const host of [
    "*.example.com",
    "127.0.0.1",
    "0x7f.0.0.1",
    "localhost",
    "metadata.internal",
    "[::1]",
    "example.com:443",
    "example.com/path",
    "user@example.com",
    "example.com.",
    " example.com",
  ])
    invalid.push(`version: 1\nembeds: [${JSON.stringify(host)}]\n`);
  for (const source of invalid) {
    expect(() => parseOutboundAllowlist(source)).toThrow();
    expect(
      outboundHosts(
        { ALLOWLIST_YAML: source, EMBED_ALLOWED_HOSTS: "legacy.example.com" },
        "embeds",
      ),
    ).toEqual([]);
  }
  expect(outboundHosts({ ALLOWLIST_YAML: valid }, "embeds")).toEqual(["preview.example.com"]);
  expect(outboundHosts({ EMBED_ALLOWED_HOSTS: "legacy.example.com,127.0.0.1" }, "embeds")).toEqual([
    "legacy.example.com",
  ]);
});

it("launcher consumes mounted YAML replacements, validates missing files and retains explicit precedence", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "flarc-allowlist-"));
  const first = "version: 1\nembeds: [first.example.com]\n";
  const second = "version: 1\nwebhooks: [second.example.com]\n";
  try {
    writeFileSync(path.join(dir, "allowlist.yaml"), first);
    expect(loadAllowlistConfig({}, dir).bindings.ALLOWLIST_YAML).toBe(first);
    expect(loadAllowlistConfig({ EMBED_ALLOWED_HOSTS: "legacy.example.com" }, dir).file).toBeNull();
    expect(loadAllowlistConfig({ ALLOWLIST_YAML: second }, dir).bindings.ALLOWLIST_YAML).toBe(
      second,
    );
    expect(
      loadAllowlistConfig(
        {
          ALLOWLIST_FILE: "allowlist.yaml",
          ALLOWLIST_YAML: second,
          EMBED_ALLOWED_HOSTS: "legacy.example.com",
        },
        dir,
      ).bindings.ALLOWLIST_YAML,
    ).toBe(first);
    for (const [name, text] of [
      ["v1", first],
      ["v2", second],
    ]) {
      mkdirSync(path.join(dir, name));
      writeFileSync(path.join(dir, name, "policy.yaml"), text);
    }
    symlinkSync("v1", path.join(dir, "..data"));
    symlinkSync("..data/policy.yaml", path.join(dir, "mounted.yaml"));
    const env = { ALLOWLIST_FILE: "mounted.yaml" };
    expect(loadAllowlistConfig(env, dir).bindings.ALLOWLIST_YAML).toBe(first);
    unlinkSync(path.join(dir, "..data"));
    symlinkSync("v2", path.join(dir, "..data"));
    expect(loadAllowlistConfig(env, dir).bindings.ALLOWLIST_YAML).toBe(second);
    writeFileSync(path.join(dir, "v2", "policy.yaml"), "version: broken");
    expect(() => loadAllowlistConfig(env, dir)).toThrow();
    expect(() => loadAllowlistConfig({ ALLOWLIST_FILE: "missing.yaml" }, dir)).toThrow();
    expect(() => loadAllowlistConfig({ ALLOWLIST_YAML: "version: broken" }, dir)).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
