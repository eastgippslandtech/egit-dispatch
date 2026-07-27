import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const VERSION = "1";
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

export async function hashWallboardPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = await deriveKey(password, salt, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
  });

  return [
    "scrypt",
    VERSION,
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyWallboardPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  try {
    const parts = encodedHash.split("$");
    if (parts.length !== 7) {
      return false;
    }

    const [algorithm, version, cost, blockSize, parallelization, encodedSalt, encodedKey] = parts;
    if (
      algorithm !== "scrypt" ||
      version !== VERSION ||
      cost !== String(COST) ||
      blockSize !== String(BLOCK_SIZE) ||
      parallelization !== String(PARALLELIZATION)
    ) {
      return false;
    }

    const salt = Buffer.from(encodedSalt, "base64url");
    const expectedKey = Buffer.from(encodedKey, "base64url");
    if (salt.length !== SALT_BYTES || expectedKey.length !== KEY_BYTES) {
      return false;
    }

    const actualKey = await deriveKey(password, salt, {
      N: COST,
      r: BLOCK_SIZE,
      p: PARALLELIZATION,
    });
    return timingSafeEqual(actualKey, expectedKey);
  } catch {
    return false;
  }
}

function deriveKey(
  password: string,
  salt: Buffer,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_BYTES, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey as Buffer);
    });
  });
}
