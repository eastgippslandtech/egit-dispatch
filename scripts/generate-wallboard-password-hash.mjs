import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const password = process.argv[2];

if (!password) {
  console.error("Usage: pnpm wallboard:hash -- <password>");
  process.exit(1);
}

const salt = randomBytes(16);
const derivedKey = await scrypt(password, salt, 32, {
  N: 16_384,
  r: 8,
  p: 1,
});

process.stdout.write(
  [
    "scrypt",
    "1",
    "16384",
    "8",
    "1",
    salt.toString("base64url"),
    Buffer.from(derivedKey).toString("base64url"),
  ].join("$"),
);
