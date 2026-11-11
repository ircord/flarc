export interface ScramAccountData {
  salt: string; // base64
  iterations: number;
  storedKey: string; // base64
  serverKey: string; // base64
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function hmacSha256(
  key: Uint8Array,
  message: Uint8Array | string,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const msgBytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, msgBytes);
  return new Uint8Array(sig);
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

export function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const res = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    res[i] = a[i] ^ b[i];
  }
  return res;
}

export async function generateScramKeys(
  password: string,
  iterations = 100_000,
): Promise<ScramAccountData> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const passBytes = new TextEncoder().encode(password);

  const keyMaterial = await crypto.subtle.importKey("raw", passBytes, "PBKDF2", false, [
    "deriveBits",
  ]);
  const saltedPasswordBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  const saltedPassword = new Uint8Array(saltedPasswordBits);

  const saltedKey = await crypto.subtle.importKey(
    "raw",
    saltedPassword,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const clientKeyBits = await crypto.subtle.sign(
    "HMAC",
    saltedKey,
    new TextEncoder().encode("Client Key"),
  );
  const clientKey = new Uint8Array(clientKeyBits);

  const serverKeyBits = await crypto.subtle.sign(
    "HMAC",
    saltedKey,
    new TextEncoder().encode("Server Key"),
  );
  const serverKey = new Uint8Array(serverKeyBits);

  const storedKeyBits = await crypto.subtle.digest("SHA-256", clientKey);
  const storedKey = new Uint8Array(storedKeyBits);

  return {
    salt: uint8ArrayToBase64(saltBytes),
    iterations,
    storedKey: uint8ArrayToBase64(storedKey),
    serverKey: uint8ArrayToBase64(serverKey),
  };
}

export function parseClientFirstMessage(msg: string): {
  clientFirstBare: string;
  username: string;
  clientNonce: string;
  authzid?: string;
} | null {
  // GS2 header: [gs2-cb-flag],[a=authzid],
  const comma1 = msg.indexOf(",");
  if (comma1 === -1) return null;
  const comma2 = msg.indexOf(",", comma1 + 1);
  if (comma2 === -1) return null;

  const headerPart = msg.slice(0, comma2);
  if (!/^[ny],(?:a=[^,]+)?$/.test(headerPart)) return null;
  let authzid: string | undefined;
  const aIdx = headerPart.indexOf(",a=");
  if (aIdx !== -1) {
    authzid = headerPart.slice(aIdx + 3);
  }

  const clientFirstBare = msg.slice(comma2 + 1);
  const parts = clientFirstBare.split(",");
  if (
    parts.some((p) => p.startsWith("m=")) ||
    new Set(parts.map((p) => p.slice(0, 2))).size !== parts.length
  )
    return null;
  let username: string | undefined;
  let clientNonce: string | undefined;

  for (const p of parts) {
    if (p.startsWith("n=")) {
      username = p.slice(2).replace(/=2C/g, ",").replace(/=3D/g, "=");
    } else if (p.startsWith("r=")) {
      clientNonce = p.slice(2);
    }
  }

  if (!username || !clientNonce || !/^[!-+\--~]+$/.test(clientNonce)) return null;
  return { clientFirstBare, username, clientNonce, authzid };
}

export function parseClientFinalMessage(msg: string): {
  clientFinalWithoutProof: string;
  channelBinding: string;
  nonce: string;
  proofB64: string;
} | null {
  const pIdx = msg.lastIndexOf(",p=");
  if (pIdx === -1) return null;

  const clientFinalWithoutProof = msg.slice(0, pIdx);
  const proofB64 = msg.slice(pIdx + 3);

  const parts = clientFinalWithoutProof.split(",");
  if (
    new Set(parts.map((p) => p.slice(0, 2))).size !== parts.length ||
    !/^[A-Za-z0-9+/]{43}=$/.test(proofB64)
  )
    return null;
  let channelBinding = "";
  let nonce = "";

  for (const p of parts) {
    if (p.startsWith("c=")) {
      channelBinding = p.slice(2);
    } else if (p.startsWith("r=")) {
      nonce = p.slice(2);
    }
  }

  if (!channelBinding || !nonce) return null;
  return { clientFinalWithoutProof, channelBinding, nonce, proofB64 };
}
