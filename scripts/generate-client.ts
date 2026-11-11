import fs from "node:fs";
import path from "node:path";
import openapiTS, { astToString } from "openapi-typescript";
import { generateOpenAPISpec } from "../server/routes/openapi.json.get";

async function main() {
  const spec = generateOpenAPISpec();
  const outputDir = path.resolve(process.cwd(), "docs/api");
  fs.mkdirSync(outputDir, { recursive: true });

  const ast = await openapiTS(spec as any);
  const contents = astToString(ast);

  const clientPath = path.join(outputDir, "client.ts");
  fs.writeFileSync(clientPath, contents, "utf-8");
  console.log(`Generated typed client definitions at: ${clientPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
