import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { Response } from "miniflare";
import { outboundHosts } from "../shared/outbound-policy.mjs";

// Conservative IANA special-purpose exclusions (registries reviewed 2026-11-12):
// https://www.iana.org/assignments/iana-ipv4-special-registry/
// https://www.iana.org/assignments/iana-ipv6-special-registry/
// More-specific globally reachable exceptions inside these blocks are intentionally denied.
const v4Denied = new net.BlockList();
for (const [address, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
])
  v4Denied.addSubnet(address, bits, "ipv4");
const v6Global = new net.BlockList();
v6Global.addSubnet("2000::", 3, "ipv6");
const v6Denied = new net.BlockList();
for (const [address, bits] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
])
  v6Denied.addSubnet(address, bits, "ipv6");

export function isPublicAddress(address) {
  if (typeof address !== "string" || address.includes("%")) return false;
  const family = net.isIP(address);
  if (family === 4) return !v4Denied.check(address, "ipv4");
  if (family === 6) return v6Global.check(address, "ipv6") && !v6Denied.check(address, "ipv6");
  return false;
}

const MAX_BYTES = 1024 * 1024;
const SAFE_HEADERS = new Set([
  "accept",
  "user-agent",
  "content-type",
  "content-encoding",
  "ttl",
  "urgency",
  "topic",
  "crypto-key",
  "encryption",
  "x-flarc-secret",
  "x-flarc-signature",
  "x-hub-signature-256",
]);
const RESPONSE_HEADERS = new Set([
  "content-type",
  "location",
  "cache-control",
  "etag",
  "last-modified",
  "retry-after",
]);
const fixed = (status, message) =>
  new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

/** Local/Kubernetes egress policy; all injected hooks are for deterministic tests. */
export function createSafeOutbound({
  getEnv,
  lookup = dns.lookup,
  transport = https.request,
  timeoutMs = 5000,
  maxBytes = MAX_BYTES,
  maxActive = 32,
} = {}) {
  if (typeof getEnv !== "function") throw new Error("Outbound policy environment is required");
  let active = 0;
  const permitted = (host) =>
    ["embeds", "webhooks", "push"].some((purpose) =>
      outboundHosts(getEnv(), purpose).includes(host),
    );
  return async function safeOutbound(request) {
    const cancelUnread = () => {
      try {
        if (request.body && !request.body.locked) request.body.cancel().catch(() => {});
      } catch {}
    };
    const rejectEarly = (status, message) => {
      cancelUnread();
      return fixed(status, message);
    };
    if (active >= maxActive) return rejectEarly(503, "Outbound capacity unavailable");
    let url;
    try {
      url = new URL(request.url);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        (url.port && url.port !== "443") ||
        !url.hostname.includes(".") ||
        url.hostname.endsWith(".") ||
        net.isIP(url.hostname) ||
        url.hostname.includes("[") ||
        !permitted(url.hostname)
      )
        return rejectEarly(403, "Outbound destination denied");
      if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase()))
        return rejectEarly(405, "Outbound method denied");
    } catch {
      return rejectEarly(403, "Outbound destination denied");
    }
    active++;
    const controller = new AbortController();
    let upstream, incoming, bodyReader;
    const stop = () => {
      try {
        bodyReader?.cancel().catch(() => {});
      } catch {}
      if (!bodyReader) cancelUnread();
      try {
        incoming?.destroy();
      } catch {}
      try {
        upstream?.destroy();
      } catch {}
    };
    controller.signal.addEventListener("abort", stop, { once: true });
    const abortFromCaller = () => controller.abort("caller");
    if (request.signal?.aborted) abortFromCaller();
    else request.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
    const aborted = new Promise((resolve) => {
      if (controller.signal.aborted) resolve(fixed(499, "Outbound request cancelled"));
      else
        controller.signal.addEventListener(
          "abort",
          () =>
            resolve(
              fixed(
                controller.signal.reason === "timeout" ? 504 : 499,
                controller.signal.reason === "timeout"
                  ? "Outbound request timed out"
                  : "Outbound request cancelled",
              ),
            ),
          { once: true },
        );
    });
    const operation = (async () => {
      try {
        const addresses = await lookup(url.hostname, { all: true, verbatim: true });
        if (controller.signal.aborted) return fixed(499, "Outbound request cancelled");
        if (
          !Array.isArray(addresses) ||
          addresses.length < 1 ||
          addresses.length > 64 ||
          addresses.some(
            (entry) =>
              !entry || !isPublicAddress(entry.address) || net.isIP(entry.address) !== entry.family,
          )
        )
          return fixed(403, "Outbound destination denied");
        const advertised = request.headers.get("content-length");
        if (advertised && (!/^\d+$/.test(advertised) || Number(advertised) > maxBytes)) {
          await request.body?.cancel();
          return fixed(413, "Outbound request too large");
        }
        const chunks = [];
        let total = 0;
        if (request.body) {
          bodyReader = request.body.getReader();
          while (true) {
            const item = await bodyReader.read();
            if (controller.signal.aborted) return fixed(499, "Outbound request cancelled");
            if (item.done) break;
            total += item.value.byteLength;
            if (total > maxBytes) {
              await bodyReader.cancel();
              return fixed(413, "Outbound request too large");
            }
            chunks.push(Buffer.from(item.value));
          }
          bodyReader = undefined;
        }
        // Policy may change during either DNS resolution or body consumption.
        if (controller.signal.aborted) return fixed(499, "Outbound request cancelled");
        if (!permitted(url.hostname)) return fixed(403, "Outbound destination denied");
        const headers = { host: url.hostname, "accept-encoding": "identity" };
        for (const [name, value] of request.headers)
          if (SAFE_HEADERS.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
        const authorization = request.headers.get("authorization");
        if (
          authorization &&
          request.method.toUpperCase() === "POST" &&
          outboundHosts(getEnv(), "push").includes(url.hostname) &&
          /^(?:vapid\s+t=[A-Za-z0-9._~-]+\s*,\s*k=[A-Za-z0-9_-]+|WebPush\s+[A-Za-z0-9._~-]+)$/i.test(
            authorization,
          )
        )
          headers.authorization = authorization;
        if (total) headers["content-length"] = String(total);
        const selected = addresses[0];
        return await new Promise((resolve) => {
          let finished = false;
          const settleAbort = () =>
            done(
              fixed(
                controller.signal.reason === "timeout" ? 504 : 499,
                controller.signal.reason === "timeout"
                  ? "Outbound request timed out"
                  : "Outbound request cancelled",
              ),
            );
          const done = (response) => {
            if (finished) return;
            finished = true;
            controller.signal.removeEventListener("abort", settleAbort);
            resolve(response);
          };
          controller.signal.addEventListener("abort", settleAbort, { once: true });
          upstream = transport(
            {
              protocol: "https:",
              hostname: selected.address,
              family: selected.family,
              port: 443,
              servername: url.hostname,
              method: request.method,
              path: `${url.pathname}${url.search}`,
              headers,
              agent: false,
              rejectUnauthorized: true,
              checkServerIdentity: (_name, cert) => tls.checkServerIdentity(url.hostname, cert),
              maxHeaderSize: 16384,
            },
            (response) => {
              incoming = response;
              const status = response.statusCode ?? 502;
              if (status < 200 || status > 599) {
                response.destroy();
                done(fixed(502, "Outbound request failed"));
                return;
              }
              const outHeaders = new Headers();
              for (const [name, value] of Object.entries(response.headers))
                if (RESPONSE_HEADERS.has(name.toLowerCase()) && value !== undefined)
                  outHeaders.set(name, Array.isArray(value) ? value.join(", ") : String(value));
              if (status >= 300 && status < 400) {
                response.destroy();
                done(new Response(null, { status, headers: outHeaders }));
                return;
              }
              const encoding = response.headers["content-encoding"];
              const length = response.headers["content-length"];
              if (
                (encoding && String(encoding).toLowerCase() !== "identity") ||
                (length && (!/^\d+$/.test(String(length)) || Number(length) > maxBytes))
              ) {
                response.destroy();
                done(fixed(502, "Outbound response rejected"));
                return;
              }
              const responseChunks = [];
              let responseBytes = 0;
              response.on("data", (chunk) => {
                responseBytes += chunk.length;
                if (responseBytes > maxBytes) {
                  response.destroy();
                  done(fixed(502, "Outbound response rejected"));
                  return;
                }
                responseChunks.push(Buffer.from(chunk));
              });
              response.once("end", () =>
                done(
                  new Response(
                    [204, 205, 304].includes(status) ? null : Buffer.concat(responseChunks),
                    { status, headers: outHeaders },
                  ),
                ),
              );
              response.once("error", () => done(fixed(502, "Outbound request failed")));
              response.once("aborted", () => done(fixed(502, "Outbound request failed")));
              response.once("close", () => {
                if (!response.complete) done(fixed(502, "Outbound request failed"));
              });
            },
          );
          upstream.once("error", () => done(fixed(502, "Outbound request failed")));
          upstream.once("close", () => {
            if (!incoming || incoming.destroyed) done(fixed(502, "Outbound request failed"));
          });
          if (controller.signal.aborted) {
            stop();
            done(fixed(499, "Outbound request cancelled"));
            return;
          }
          upstream.end(total ? Buffer.concat(chunks) : undefined);
        });
      } catch {
        stop();
        return fixed(502, "Outbound request failed");
      }
    })().finally(() => {
      cancelUnread();
      active--;
    });
    try {
      return await Promise.race([operation, aborted]);
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", abortFromCaller);
    }
  };
}
