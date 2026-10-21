import {
  randomBytes,
  createHmac,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes) {
  let bits = 0,
    value = 0,
    out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function decode(text) {
  let bits = 0,
    value = 0,
    out = [];
  for (const char of text) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw Error("Invalid factor secret.");
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totp(secret, step, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", decode(secret)).update(counter).digest(),
    offset = h[19] & 15;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(
    digits,
    "0",
  );
}
export function acceptedStep(secret, code, now = Date.now(), after = -1) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const step of [current, current - 1, current + 1])
    if (
      step > after &&
      timingSafeEqual(Buffer.from(totp(secret, step)), Buffer.from(code))
    )
      return step;
  return null;
}
const hash = (code) =>
  createHash("sha256")
    .update(code.replaceAll("-", "").toLowerCase())
    .digest("hex");
export function createMfa({ identity, config }) {
  const storage = identity.security;
  const attempts = new Map();
  function allowed(uid) {
    const item = attempts.get(uid);
    if (item && item.until > Date.now() && item.count >= 10) return false;
    if (!item || item.until <= Date.now())
      attempts.set(uid, { count: 0, until: Date.now() + 900000 });
    attempts.get(uid).count++;
    return true;
  }
  let master;
  if (config.authKeyPath) {
    if (!existsSync(config.authKeyPath)) {
      if (storage.factorCount())
        throw Error(
          "MFA encryption key is missing. Restore it before starting.",
        );
      mkdirSync(dirname(config.authKeyPath), { recursive: true });
      writeFileSync(config.authKeyPath, randomBytes(32), {
        flag: "wx",
        mode: 0o600,
      });
    }
    master = readFileSync(config.authKeyPath);
    if (master.length !== 32)
      throw Error("MFA key must contain 32 random bytes.");
  } else master = randomBytes(32);
  const encrypt = (text) => {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", master, iv),
      data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), data]
      .map((b) => b.toString("hex"))
      .join(":");
  };
  const decrypt = (text) => {
    const [iv, tag, data] = text.split(":").map((v) => Buffer.from(v, "hex")),
      dec = createDecipheriv("aes-256-gcm", master, iv);
    dec.setAuthTag(tag);
    return dec.update(data, undefined, "utf8") + dec.final("utf8");
  };
  return {
    enabled: (uid) => !!storage.factor(uid)?.enabled,
    begin(uid) {
      if (storage.factor(uid)?.enabled) throw Error("MFA is already enabled.");
      const secret = base32(randomBytes(20));
      storage.setFactor(uid, encrypt(secret), Date.now() + 900000);
      return { secret };
    },
    confirm(uid, code) {
      if (!allowed(uid))
        throw Error("Too many factor attempts. Retry in 15 minutes.");
      const factor = storage.factor(uid);
      if (!factor || factor.enabled || factor.expires < Date.now())
        throw Error("Enrollment expired. Start again.");
      const step = acceptedStep(decrypt(factor.secret), code);
      if (step === null) throw Error("Authenticator code is incorrect.");
      const codes = Array.from({ length: 10 }, () =>
        randomBytes(12)
          .toString("hex")
          .match(/.{1,6}/g)
          .join("-"),
      );
      attempts.delete(uid);
      storage.enableFactor(uid, step, codes.map(hash));
      identity.revoke(uid);
      return { recoveryCodes: codes };
    },
    verify(uid, code) {
      if (!allowed(uid)) return false;
      const f = storage.factor(uid);
      if (!f?.enabled) return false;
      if (typeof code !== "string" || code.length > 64) return false;
      const step = acceptedStep(
        decrypt(f.secret),
        code,
        Date.now(),
        f.last_step,
      );
      const valid =
        step !== null
          ? storage.consumeStep(uid, step)
          : storage.consumeRecovery(uid, hash(code));
      if (valid) attempts.delete(uid);
      return valid;
    },
    disable(uid) {
      storage.removeFactor(uid);
      identity.revoke(uid);
    },
  };
}
