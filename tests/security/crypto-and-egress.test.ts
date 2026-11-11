import { pbkdf2Sync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeSaslPlain, hashPassword, verifyPassword } from "~/core/authentication/passwords";
import {
  base64ToUint8Array,
  generateScramKeys,
  hmacSha256,
  parseClientFinalMessage,
  parseClientFirstMessage,
  sha256,
  uint8ArrayToBase64,
  xorBytes,
} from "~/core/authentication/scram";
import { resolveUrlEmbed } from "~/services/embeds/resolver";
import { allowedOutboundUrl, fetchAllowedResource } from "~/services/outbound";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Credential verification against independent vectors", () => {
  it("matches the RFC 7677 section 3 SCRAM-SHA-256 exchange", async () => {
    // Source: https://www.rfc-editor.org/rfc/rfc7677.txt section 3.
    const salt = "W22ZaJ0SNY7soEsUEjb6gQ==";
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array: any) => {
      array.set(Buffer.from(salt, "base64"));
      return array;
    });
    const keys = await generateScramKeys("pencil", 4096);
    expect(keys.salt).toBe(salt);
    const nonce = "rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0";
    const first = "n=user,r=rOprNGfwEbeRWgbNEkqO";
    const serverFirst = `r=${nonce},s=${salt},i=4096`;
    const final = `c=biws,r=${nonce}`;
    const authMessage = `${first},${serverFirst},${final}`;
    const saltedPassword = pbkdf2Sync("pencil", Buffer.from(salt, "base64"), 4096, 32, "sha256");
    const clientKey = await hmacSha256(saltedPassword, "Client Key");
    expect(uint8ArrayToBase64(await sha256(clientKey))).toBe(keys.storedKey);
    const proof = xorBytes(
      clientKey,
      await hmacSha256(base64ToUint8Array(keys.storedKey), authMessage),
    );
    expect(uint8ArrayToBase64(proof)).toBe("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=");
    expect(
      uint8ArrayToBase64(await hmacSha256(base64ToUint8Array(keys.serverKey), authMessage)),
    ).toBe("6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=");
    expect(parseClientFirstMessage(`n,,${first}`)?.username).toBe("user");
    expect(parseClientFinalMessage(`${final},p=${uint8ArrayToBase64(proof)}`)?.nonce).toBe(nonce);
  });

  it("verifies salted passwords, rejects incorrect passwords and corrupt verifier encodings", async () => {
    const one = await hashPassword("correct horse battery staple");
    const two = await hashPassword("correct horse battery staple");
    expect(one).not.toBe(two);
    expect(await verifyPassword("correct horse battery staple", one)).toBe(true);
    expect(await verifyPassword("wrong password", one)).toBe(false);
    for (const verifier of [
      "plaintext",
      "pbkdf2:0:00:00",
      "pbkdf2:1000000000:00:00",
      `pbkdf2:100000:${"zz".repeat(16)}:${"00".repeat(32)}`,
    ]) {
      expect(await verifyPassword("password", verifier)).toBe(false);
    }
    expect(decodeSaslPlain(btoa("one\0two\0three\0four"))).toBeNull();
    expect(decodeSaslPlain("not base64!")).toBeNull();
  });

  it("rejects ambiguous SCRAM attributes and unsupported channel-binding negotiation", () => {
    for (const first of [
      "p=tls-exporter,,n=user,r=nonce",
      "n,,n=user,n=other,r=nonce",
      "n,,n=user,r=one,r=two",
      "n,,m=extension,n=user,r=nonce",
      "n,,n=user,r=bad nonce",
    ])
      expect(parseClientFirstMessage(first)).toBeNull();
    expect(parseClientFinalMessage("c=biws,c=AAAA,r=nonce,p=bad")).toBeNull();
  });
});

describe("Outbound HTTP capability and response bounds", () => {
  it.each([
    "http://example.com/",
    "https://127.0.0.1/",
    "https://2130706433/",
    "https://0x7f000001/",
    "https://[::1]/",
    "https://169.254.169.254/latest/meta-data",
    "https://example.com:8443/",
    "https://user:password@example.com/",
    "https://example.com.attacker.org/",
    "https://example.com./",
  ])("rejects untrusted destination %s", (url) => {
    expect(allowedOutboundUrl(url, ["example.com"])).toBeNull();
  });

  it("does not fetch unconfigured previews or follow a redirect to a private address", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/secrets" } }),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(await resolveUrlEmbed("https://example.com/page")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await fetchAllowedResource("https://example.com/page", ["example.com"])).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("bounds streamed response bytes and never returns executable oEmbed HTML", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("x".repeat(64), { headers: { "Content-Type": "text/html" } }),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchAllowedResource("https://example.com/page", ["example.com"], 16)).toBeNull();
    fetcher.mockResolvedValueOnce(
      new Response('<link type="application/json+oembed" href="https://example.com/oembed">', {
        headers: { "Content-Type": "text/html" },
      }),
    );
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ title: "Safe title", html: "<script>attack()</script>" }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const embed = await resolveUrlEmbed("https://example.com/page", ["example.com"]);
    expect(embed?.title).toBe("Safe title");
    expect(embed?.html).toBeNull();
  });
});
