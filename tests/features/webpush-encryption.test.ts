import {
  createDecipheriv,
  createECDH,
  createHmac,
  createPublicKey,
  generateKeyPairSync,
  verify,
} from "node:crypto";
import { expect, it } from "vitest";
import { encryptWebPush, vapidAuthorization } from "../../server/services/push/encryption";

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const mac = (key: Uint8Array, value: Uint8Array) =>
  createHmac("sha256", key).update(value).digest();
const expand = (key: Uint8Array, info: Uint8Array, length: number) =>
  mac(key, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);

it("produces an independently decryptable RFC 8291 record and verifiable VAPID JWT", async () => {
  const receiver = createECDH("prime256v1");
  const receiverPublic = receiver.generateKeys();
  const auth = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const message = Buffer.from('{"eventId":"private-event","type":"message.created"}');
  const body = Buffer.from(await encryptWebPush(message, b64(receiverPublic), b64(auth)));
  expect(body.readUInt32BE(16)).toBe(4096);
  expect(body[20]).toBe(65);
  const salt = body.subarray(0, 16);
  const senderPublic = body.subarray(21, 86);
  const shared = receiver.computeSecret(senderPublic);
  const ikm = expand(
    mac(auth, shared),
    Buffer.concat([Buffer.from("WebPush: info\0"), receiverPublic, senderPublic]),
    32,
  );
  const prk = mac(salt, ikm);
  const key = expand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = expand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);
  const ciphertext = body.subarray(86);
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const clear = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  expect(clear).toEqual(Buffer.concat([message, Buffer.from([2])]));

  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const vapidPublic = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x!, "base64url"),
    Buffer.from(jwk.y!, "base64url"),
  ]);
  const authorization = await vapidAuthorization(
    "https://push.example.com/send/1",
    b64(vapidPublic),
    jwk.d!,
    "mailto:admin@example.com",
  );
  const token = authorization.match(/^vapid t=([^,]+), k=/)?.[1];
  expect(token).toBeTruthy();
  const [header, claims, signature] = token!.split(".");
  expect(JSON.parse(Buffer.from(claims, "base64url").toString()).aud).toBe(
    "https://push.example.com",
  );
  expect(
    verify(
      "sha256",
      Buffer.from(`${header}.${claims}`),
      { key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    ),
  ).toBe(true);
});
