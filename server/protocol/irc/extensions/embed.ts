/**
 * Rich Embeds Specification (flarc.chat/embed, draft/embed)
 *
 * Implements Discord / IRCord compatible rich media embeds across IRC and REST.
 */

export const EMBED_CAP = "draft/embed";
export const EMBED_VENDOR_CAP = "flarc.chat/embed";

export interface DiscordEmbedAuthor {
  name: string;
  url?: string;
  icon_url?: string;
}

export interface DiscordEmbedFooter {
  text: string;
  icon_url?: string;
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbedImage {
  url: string;
  height?: number;
  width?: number;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: DiscordEmbedFooter;
  image?: DiscordEmbedImage;
  thumbnail?: DiscordEmbedImage;
  author?: DiscordEmbedAuthor;
  fields?: DiscordEmbedField[];
}

export function formatEmbedToPlainText(embed: DiscordEmbed): string {
  const parts: string[] = [];

  if (embed.author?.name) {
    parts.push(embed.author.name);
  }

  if (embed.title) {
    parts.push(embed.url ? `**[${embed.title}](${embed.url})**` : `**${embed.title}**`);
  }

  if (embed.description) {
    parts.push(embed.description);
  }

  if (embed.fields && embed.fields.length > 0) {
    const fieldLines = embed.fields.map((f) => `• ${f.name}: ${f.value}`);
    parts.push(fieldLines.join(" | "));
  }

  if (embed.image?.url) {
    parts.push(embed.image.url);
  }

  if (embed.footer?.text) {
    parts.push(`— ${embed.footer.text}`);
  }

  return parts.filter(Boolean).join(" ");
}
