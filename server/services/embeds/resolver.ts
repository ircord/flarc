import { fetchAllowedResource } from "../outbound";
/**
 * oEmbed & OpenGraph Link Preview Resolver
 *
 * Safely extracts link preview metadata from web pages:
 * - OpenGraph tags: og:title, og:description, og:image, og:site_name, og:type, theme-color
 * - Twitter Card tags: twitter:title, twitter:description, twitter:image
 * - HTML fallbacks: <title>, <meta name="description">
 * - oEmbed discovery: <link rel="alternate" type="application/json+oembed" href="...">
 *
 * References:
 * - https://ogp.me/
 * - https://oembed.com/
 */

export interface EmbedMetadata {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  author: string | null;
  image: string | null;
  thumbnail: string | null;
  type: "link" | "article" | "photo" | "video" | "rich";
  html?: string | null;
  color?: string | null;
}

const MAX_FETCH_BYTES = 1024 * 1024; // 1MB limit for preview HTML
const _FETCH_TIMEOUT_MS = 5000;

/**
 * Extracts all HTTP/HTTPS URLs found in a string of text.
 */
export function extractUrls(text: string): string[] {
  // Matches URLs ending at whitespace or angle brackets
  const urlRegex = /\bhttps?:\/\/[^\s<>"'\x00-\x1f]+/gi;
  const rawMatches = text.match(urlRegex) ?? [];
  const cleaned = rawMatches.map((u) => u.replace(/[.,;:!?)]+$/, "")).filter(Boolean);
  return Array.from(new Set(cleaned));
}

/**
 * Resolves oEmbed and OpenGraph metadata for a given URL.
 */
export async function resolveUrlEmbed(
  targetUrl: string,
  allowedHosts: string[] = [],
): Promise<EmbedMetadata | null> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const fetched = await fetchAllowedResource(targetUrl, allowedHosts);
    if (!fetched) return null;
    const response = fetched.response;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("image/")) {
      return {
        url: targetUrl,
        title: parsedUrl.pathname.split("/").pop() || parsedUrl.hostname,
        description: null,
        siteName: parsedUrl.hostname,
        author: null,
        image: targetUrl,
        thumbnail: targetUrl,
        type: "photo",
      };
    }

    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return null;
    }

    const html = fetched.text;
    const truncatedHtml = html.slice(0, MAX_FETCH_BYTES);

    // 1. Check for oEmbed endpoint link in HTML
    const oembedLinkMatch =
      truncatedHtml.match(
        /<link[^>]+type=["']application\/json\+oembed["'][^>]+href=["']([^"']+)["']/i,
      ) ||
      truncatedHtml.match(
        /<link[^>]+href=["']([^"']+)["'][^>]+type=["']application\/json\+oembed["']/i,
      );

    if (oembedLinkMatch?.[1]) {
      const oembedUrl = new URL(oembedLinkMatch[1], targetUrl).toString();
      try {
        const oembedRes = await fetchAllowedResource(oembedUrl, allowedHosts, 128 * 1024);
        if (oembedRes) {
          const data = JSON.parse(oembedRes.text) as any;
          if (data && typeof data === "object") {
            return {
              url: targetUrl,
              title: data.title ?? null,
              description: data.description ?? null,
              siteName: data.provider_name ?? parsedUrl.hostname,
              author: data.author_name ?? null,
              image: data.thumbnail_url ?? (data.type === "photo" ? data.url : null),
              thumbnail: data.thumbnail_url ?? null,
              type: data.type === "video" ? "video" : data.type === "photo" ? "photo" : "link",
              html: null, // Never relay executable third-party HTML.
            };
          }
        }
      } catch {
        // Fall back to meta tag parsing
      }
    }

    // 2. OpenGraph & Meta tag extraction
    const getMeta = (prop: string): string | null => {
      const escaped = prop.replace(/:/g, "\\:");
      const match =
        truncatedHtml.match(
          new RegExp(
            `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
            "i",
          ),
        ) ||
        truncatedHtml.match(
          new RegExp(
            `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`,
            "i",
          ),
        );
      return match?.[1] ? decodeHtmlEntities(match[1].trim()) : null;
    };

    // Extract title
    let title = getMeta("og:title") || getMeta("twitter:title");
    if (!title) {
      const titleTagMatch = truncatedHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleTagMatch?.[1]) {
        title = decodeHtmlEntities(titleTagMatch[1].trim());
      }
    }

    // Extract description
    const description =
      getMeta("og:description") || getMeta("twitter:description") || getMeta("description");

    // Extract image
    let image = getMeta("og:image:secure_url") || getMeta("og:image") || getMeta("twitter:image");
    if (image) {
      try {
        image = new URL(image, targetUrl).toString();
      } catch {}
    }

    // Site name
    const siteName = getMeta("og:site_name") || getMeta("twitter:site") || parsedUrl.hostname;

    // Author
    const author = getMeta("author") || getMeta("article:author") || getMeta("twitter:creator");

    // Type
    const rawType = getMeta("og:type");
    const type: EmbedMetadata["type"] =
      rawType === "video" || rawType?.startsWith("video.")
        ? "video"
        : rawType === "article"
          ? "article"
          : image
            ? "photo"
            : "link";

    // Theme color
    const color = getMeta("theme-color");

    if (!title && !description && !image) {
      return null;
    }

    return {
      url: targetUrl,
      title: title ? title.slice(0, 300) : null,
      description: description ? description.slice(0, 1000) : null,
      siteName: siteName ? siteName.slice(0, 100) : null,
      author: author ? author.slice(0, 100) : null,
      image,
      thumbnail: image,
      type,
      color,
    };
  } catch (_err) {
    return null;
  }
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}
