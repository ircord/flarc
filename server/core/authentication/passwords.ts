export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100_000;
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  const saltHex = bytesToHex(salt);
  const hashHex = bytesToHex(new Uint8Array(derivedBits));
  return `pbkdf2:${iterations}:${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") {
    return false;
  }
  const iterations = Number(parts[1]);
  if (
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > 100_000 ||
    !/^[a-f0-9]{32}$/i.test(parts[2]) ||
    !/^[a-f0-9]{64}$/i.test(parts[3])
  )
    return false;
  const salt = hexToBytes(parts[2]);
  const expectedHash = hexToBytes(parts[3]);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  const actualHash = new Uint8Array(derivedBits);
  if (actualHash.length !== expectedHash.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < actualHash.length; i++) {
    diff |= actualHash[i] ^ expectedHash[i];
  }
  return diff === 0;
}

export function decodeSaslPlain(base64Payload: string): {
  authzid: string;
  authcid: string;
  password: string;
} | null {
  try {
    const binaryStr = atob(base64Payload);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    const parts = decoded.split("\x00");
    if (parts.length !== 3) {
      return null;
    }
    const [authzid, authcid, password] = parts;
    if (!authcid || !password) {
      return null;
    }
    return {
      authzid: authzid || authcid,
      authcid,
      password,
    };
  } catch {
    return null;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
