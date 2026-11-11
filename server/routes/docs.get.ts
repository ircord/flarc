import { defineEventHandler, setResponseHeader } from "nitro/h3";

export default defineEventHandler((event) => {
  setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
  return `<!doctype html>
<html>
  <head>
    <title>FlaRC API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="/icon.svg" />
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/openapi.json"
      src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
});
