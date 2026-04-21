/**
 * Generates an encrypted Ethereum V3 keystore from a private key.
 * Usage: node scripts/create-keystore.mjs
 */

import { writeFile, mkdir, chmod } from "node:fs/promises";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { randomBytes, scryptSync, createCipheriv } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256 } from "viem";

// Mutable stderr stream — lets us suppress echo during sensitive prompts so
// private keys and passphrases don't appear on screen.
const mutableStderr = new Writable({
  write(chunk, encoding, callback) {
    if (!this.muted) process.stderr.write(chunk, encoding);
    callback();
  },
});
mutableStderr.muted = false;

const rl = createInterface({
  input: process.stdin,
  output: mutableStderr,
  terminal: true,
});

function askSilent(q) {
  return new Promise((resolve) => {
    process.stderr.write(q);
    mutableStderr.muted = true;
    rl.question("", (answer) => {
      mutableStderr.muted = false;
      process.stderr.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  console.error("\n=== Keystore Generator ===\n");
  console.error("Input is hidden for security. Paste or type; the characters will not appear on screen.\n");

  const privateKey = await askSilent("Private key (0x...): ");
  if (!privateKey.startsWith("0x") || privateKey.length !== 66) {
    console.error("Error: key must start with 0x and be 66 characters long.");
    process.exit(1);
  }

  const passphrase = await askSilent("Passphrase (to encrypt the keystore): ");
  if (passphrase.length < 4) {
    console.error("Error: passphrase too short (minimum 4 characters).");
    process.exit(1);
  }

  const passphrase2 = await askSilent("Repeat passphrase: ");
  if (passphrase !== passphrase2) {
    console.error("Error: passphrases do not match.");
    process.exit(1);
  }

  rl.close();

  console.error("\nGenerating keystore...");

  const pkBytes = Buffer.from(privateKey.replace(/^0x/, ""), "hex");
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const n = 8192, r = 8, p = 1, dklen = 32;

  const derivedKey = scryptSync(Buffer.from(passphrase, "utf-8"), salt, dklen, { N: n, r, p });

  const cipher = createCipheriv("aes-128-ctr", derivedKey.subarray(0, 16), iv);
  const ciphertext = Buffer.concat([cipher.update(pkBytes), cipher.final()]);

  const macInput = `0x${Buffer.concat([derivedKey.subarray(16), ciphertext]).toString("hex")}`;
  const mac = keccak256(macInput).slice(2);

  const account = privateKeyToAccount(privateKey);

  const keystore = {
    version: 3,
    id: randomBytes(16).toString("hex"),
    address: account.address.toLowerCase().replace("0x", ""),
    crypto: {
      ciphertext: ciphertext.toString("hex"),
      cipherparams: { iv: iv.toString("hex") },
      cipher: "aes-128-ctr",
      kdf: "scrypt",
      kdfparams: { dklen, salt: salt.toString("hex"), n, r, p },
      mac,
    },
  };

  const dir = join(homedir(), ".keystore");
  await mkdir(dir, { recursive: true });
  const outPath = join(dir, "wallet.json");
  await writeFile(outPath, JSON.stringify(keystore, null, 2));
  await chmod(outPath, 0o600);

  console.error(`\nKeystore saved to: ${outPath}`);
  console.error(`Address: ${account.address}`);
  console.error(`Permissions: 600 (readable only by your user)`);
  console.error(`\nConfigure in .env or environment variables:`);
  console.error(`  KEYSTORE_PATH=${outPath}`);
  console.error(`  KEYSTORE_PASSPHRASE=<your passphrase>`);
  console.error(`\nReminder: delete any plaintext private-key file from your machine.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
