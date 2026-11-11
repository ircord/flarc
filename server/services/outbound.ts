/** Outbound HTTP is an explicit operator-granted capability, never an arbitrary URL proxy. */
export function allowedOutboundUrl(raw: string, allowedHosts: string[]): URL | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return null;
    if (
      !host.includes(".") ||
      host.endsWith(".") ||
      /[[\]:]/.test(host) ||
      /^\d+(?:\.\d+)*$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
    )
      return null;
    return allowedHosts.map((h) => h.trim().toLowerCase()).includes(host) ? url : null;
  } catch {
    return null;
  }
}

export async function fetchAllowedResource(
  raw: string,
  allowedHosts: string[],
  maxBytes = 1024 * 1024,
): Promise<{ response: Response; text: string; url: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    let url = allowedOutboundUrl(raw, allowedHosts);
    for (let redirects = 0; url && redirects <= 3; redirects++) {
      const response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "FlaRC-LinkPreview/1.0", Accept: "text/html,application/json" },
      });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get("location");
        await response.body?.cancel();
        url = next ? allowedOutboundUrl(new URL(next, url).href, allowedHosts) : null;
        continue;
      }
      if (!response.ok || Number(response.headers.get("content-length")) > maxBytes) {
        await response.body?.cancel();
        return null;
      }
      const reader = response.body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { response, text: new TextDecoder().decode(bytes), url: url.href };
    }
  } catch {
    /* Timeouts and failed egress are a missing preview, never a successful write. */
  } finally {
    clearTimeout(timer);
  }
  return null;
}
