import { defineEventHandler, setResponseHeader } from "nitro/h3";

export default defineEventHandler((event) => {
  setResponseHeader(event, "Content-Type", "image/svg+xml");
  setResponseHeader(event, "Cache-Control", "public, max-age=86400");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
    <rect width="128" height="128" rx="28" fill="#F38020"/>
    <text x="64" y="82" font-family="system-ui, sans-serif" font-size="60" font-weight="800" fill="#ffffff" text-anchor="middle">F</text>
  </svg>`;
});
