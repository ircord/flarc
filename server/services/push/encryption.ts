/** RFC 8291 Web Push encryption and RFC 8292 VAPID authentication. */
const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
  const bytes = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

function encode(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, data));
}

async function expand(key: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  return (await hmac(key, concat(info, new Uint8Array([1])))).slice(0, length);
}

export async function encryptWebPush(
  payload: Uint8Array,
  p256dh: string,
  auth: string,
): Promise<Uint8Array> {
  const userPublic = decode(p256dh);
  const authSecret = decode(auth);
  if (
    userPublic.length !== 65 ||
    userPublic[0] !== 4 ||
    authSecret.length !== 16 ||
    payload.length > 3993
  )
    throw new Error("Invalid Web Push subscription or payload");
  const recipient = await crypto.subtle.importKey(
    "raw",
    userPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ephemeral = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const serverPublic = new Uint8Array(
    (await crypto.subtle.exportKey("raw", ephemeral.publicKey)) as ArrayBuffer,
  );
  const subtle = crypto.subtle as unknown as {
    deriveBits(
      algorithm: { name: string; public: CryptoKey },
      base: CryptoKey,
      length: number,
    ): Promise<ArrayBuffer>;
  };
  const shared = new Uint8Array(
    await subtle.deriveBits({ name: "ECDH", public: recipient }, ephemeral.privateKey, 256),
  );
  const keyPrk = await hmac(authSecret, shared);
  const ikm = await expand(
    keyPrk,
    concat(encoder.encode("WebPush: info\0"), userPublic, serverPublic),
    32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const key = await expand(prk, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await expand(prk, encoder.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      aes,
      concat(payload, new Uint8Array([2])),
    ),
  );
  return concat(salt, new Uint8Array([0, 0, 16, 0, 65]), serverPublic, ciphertext);
}

export async function vapidAuthorization(
  endpoint: string,
  publicKey: string,
  privateKey: string,
  subject: string,
): Promise<string> {
  const publicBytes = decode(publicKey);
  const privateBytes = decode(privateKey);
  if (
    publicBytes.length !== 65 ||
    publicBytes[0] !== 4 ||
    privateBytes.length !== 32 ||
    !/^(mailto:|https:\/\/)/.test(subject)
  )
    throw new Error("Invalid VAPID configuration");
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: encode(publicBytes.slice(1, 33)),
      y: encode(publicBytes.slice(33, 65)),
      d: encode(privateBytes),
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = encode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = encode(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: subject,
      }),
    ),
  );
  const input = `${header}.${claims}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(input)),
  );
  return `vapid t=${input}.${encode(signature)}, k=${publicKey}`;
}
