import { createError } from "nitro/h3";

export async function readBoundedBody(request: Request, limit: number): Promise<ArrayBuffer> {
  if (Number(request.headers.get("content-length")) > limit)
    throw createError({ statusCode: 413, statusMessage: "Request body too large" });
  const reader = request.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw createError({ statusCode: 413, statusMessage: "Request body too large" });
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}
