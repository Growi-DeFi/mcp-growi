import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { createDecipheriv, scryptSync, pbkdf2Sync } from "node:crypto";
import type { VersionStatus } from "./index.js";
import { depositLock, withdrawLock } from "../locks/lock-period.js";
import {
  formatUnits,
  parseUnits,
  encodeFunctionData,
  createWalletClient,
  http,
  keccak256,
  toFunctionSelector,
  type Address,
  type Hex,
  type Account,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import {
  createArbitrumClient,
  GROWI_HF_VAULT_ADDRESS,
  GWHF_TOKEN_ADDRESS,
  USDC_TOKEN_ADDRESS,
  HL_LEADER_ADDRESS,
  HL_VAULT_ADDRESS,
} from "../contract/index.js";
import { GROWI_HF_VAULT_ABI, ERC20_ABI } from "../contract/index.js";

const client = createArbitrumClient();

/** Hex suffix appended to calldata in execute_transaction for on-chain attribution.
 *  "MCP-GROWI" in hex, zero-padded to 32 bytes. Visible in Arbiscan tx input data. */
const MCP_CALLDATA_TAG = "4d43502d47524f57490000000000000000000000000000000000000000000000";

/** Selector for GrowiHFVault.deposit(uint256). Used to gate post-tx deposit polling
 *  so an approve-only execution doesn't trigger a 60s "waiting for deposit" wait. */
const DEPOSIT_SELECTOR = toFunctionSelector("function deposit(uint256 amount)");

function txListContainsDeposit(txs: { to: string; data: string }[]): boolean {
  const vault = GROWI_HF_VAULT_ADDRESS.toLowerCase();
  const sel = DEPOSIT_SELECTOR.toLowerCase();
  return txs.some(
    (tx) =>
      tx.to.toLowerCase() === vault && tx.data.toLowerCase().startsWith(sel),
  );
}

/**
 * Decrypts an Ethereum V3 keystore JSON (the format MetaMask exports).
 * Supports scrypt and pbkdf2 KDFs. Uses only Node.js built-in crypto.
 */
function decryptEthKeystore(keystoreJson: Record<string, unknown>, passphrase: string): Hex {
  const crypto = (keystoreJson.crypto ?? keystoreJson.Crypto) as Record<string, unknown>;
  if (!crypto) throw new Error("Invalid keystore: missing 'crypto' field");

  const { kdf, kdfparams, ciphertext, cipherparams, mac } = crypto as {
    kdf: string;
    kdfparams: Record<string, unknown>;
    ciphertext: string;
    cipherparams: { iv: string };
    mac: string;
  };

  const passBuffer = Buffer.from(passphrase, "utf8");
  const salt = Buffer.from(kdfparams.salt as string, "hex");
  const dklen = kdfparams.dklen as number;

  let derivedKey: Buffer;
  if (kdf === "scrypt") {
    derivedKey = scryptSync(passBuffer, salt, dklen, {
      N: kdfparams.n as number,
      r: kdfparams.r as number,
      p: kdfparams.p as number,
    });
  } else if (kdf === "pbkdf2") {
    derivedKey = pbkdf2Sync(passBuffer, salt, kdfparams.c as number, dklen, "sha256");
  } else {
    throw new Error(`Unsupported KDF: ${kdf}`);
  }

  // Verify MAC: keccak256(derivedKey[16:32] + ciphertext)
  const ctBytes = Buffer.from(ciphertext, "hex");
  const macInput = `0x${Buffer.concat([derivedKey.slice(16, 32), ctBytes]).toString("hex")}` as Hex;
  const computedMac = keccak256(macInput).slice(2);
  if (computedMac.toLowerCase() !== mac.toLowerCase()) {
    throw new Error("Invalid passphrase — MAC verification failed.");
  }

  // Decrypt with AES-128-CTR
  const decipher = createDecipheriv("aes-128-ctr", derivedKey.slice(0, 16), Buffer.from(cipherparams.iv, "hex"));
  const privKeyBuffer = Buffer.concat([decipher.update(ctBytes), decipher.final()]);
  return `0x${privKeyBuffer.toString("hex")}` as Hex;
}

export async function loadSigningAccount(): Promise<Account | null> {
  // Option 1: raw private key directly in env var
  const privateKey = process.env.PRIVATE_KEY;
  if (privateKey) {
    try {
      return privateKeyToAccount(privateKey as Hex);
    } catch (e) {
      console.error(`[growi-mcp] Invalid PRIVATE_KEY — execute_transaction disabled:`, e instanceof Error ? e.message : e);
      return null;
    }
  }

  // Option 2: keystore file (auto-detects encrypted vs plain JSON)
  const keystorePath = process.env.KEYSTORE_PATH;
  if (keystorePath) {
    try {
      const content = JSON.parse(readFileSync(keystorePath, "utf-8"));

      // Encrypted Ethereum keystore (MetaMask export format — has "crypto" or "Crypto" field)
      if (content.crypto || content.Crypto) {
        const passphrase = process.env.KEYSTORE_PASSPHRASE;
        if (!passphrase) {
          console.error(`[growi-mcp] KEYSTORE_PATH is an encrypted keystore but KEYSTORE_PASSPHRASE is not set — execute_transaction disabled.`);
          return null;
        }
        console.error(`[growi-mcp] Decrypting keystore from ${keystorePath}...`);
        const privateKey = decryptEthKeystore(content, passphrase);
        return privateKeyToAccount(privateKey);
      }

      // Plain JSON keystore: { "privateKey": "0x..." }
      if (!content.privateKey) {
        console.error(`[growi-mcp] KEYSTORE_PATH file has no "privateKey" field and is not an encrypted keystore — execute_transaction disabled.`);
        return null;
      }
      return privateKeyToAccount(content.privateKey as Hex);
    } catch (e) {
      console.error(`[growi-mcp] Failed to load keystore from ${keystorePath}:`, e instanceof Error ? e.message : e);
      return null;
    }
  }

  return null;
}

function validateAddress(wallet: string): Address {
  if (!isAddress(wallet)) {
    throw new Error(`Invalid Ethereum address: ${wallet}`);
  }
  return wallet as Address;
}

function errorResponse(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

interface PreparedTx {
  to: Address;
  data: Hex;
  description: string;
}

// Chainlink ETH/USD price feed on Arbitrum One (8 decimals)
const CHAINLINK_ETH_USD = "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612" as const;
const CHAINLINK_ABI = [{ inputs: [], name: "latestRoundData", outputs: [{ name: "roundId", type: "uint80" }, { name: "answer", type: "int256" }, { name: "startedAt", type: "uint256" }, { name: "updatedAt", type: "uint256" }, { name: "answeredInRound", type: "uint80" }], stateMutability: "view", type: "function" }] as const;

async function estimateGasCost(txs: PreparedTx[], from: Address): Promise<string> {
  try {
    const [gasEstimates, gasPrice, chainlinkData] = await Promise.all([
      Promise.all(txs.map((tx) =>
        client.estimateGas({ account: from, to: tx.to, data: tx.data, value: 0n })
      )),
      client.getGasPrice(),
      client.readContract({ address: CHAINLINK_ETH_USD, abi: CHAINLINK_ABI, functionName: "latestRoundData" }),
    ]);

    const totalGas = gasEstimates.reduce((sum, g) => sum + g, 0n);
    const costWei = totalGas * gasPrice;
    const costEth = Number(formatUnits(costWei, 18));
    const ethUsdPrice = Number(chainlinkData[1]) / 1e8;
    const costUsd = costEth * ethUsdPrice;

    return `Estimated gas: ~${costEth.toFixed(6)} ETH (~$${costUsd.toFixed(4)} USD)`;
  } catch {
    return "Gas estimation unavailable.";
  }
}

export function registerWriteTools(server: McpServer, signingAccount: Account | null, versionStatus: VersionStatus): void {
  // Block write operations if MCP version is outdated (security: ABI or contract address may have changed)
  function checkVersionOrBlock(): string | null {
    if (versionStatus.outdated && versionStatus.message) {
      return versionStatus.message;
    }
    return null;
  }
  if (signingAccount) {
    server.tool(
      "get_configured_wallet",
      "Returns the Ethereum address of the locally configured signing wallet. Only available when a private key or keystore is configured.",
      {},
      async () => ({
        content: [{ type: "text" as const, text: `Configured wallet address: ${signingAccount.address}` }],
      }),
    );
  }

  server.tool(
    "prepare_deposit",
    "Prepare unsigned transactions to deposit USDC into the GrowiHFVault. Returns approve + deposit calldata ready to sign externally. The server does NOT handle private keys.",
    {
      amount_usdc: z.string().describe("Amount of USDC to deposit (e.g. '100.5')"),
      wallet: z.string().describe("Depositor wallet address"),
    },
    async ({ amount_usdc, wallet }) => {
      const versionBlock = checkVersionOrBlock();
      if (versionBlock) return errorResponse(versionBlock);

      try {
        const address = validateAddress(wallet);

        let qty: bigint;
        try {
          qty = parseUnits(amount_usdc, 6);
        } catch {
          return errorResponse(`Invalid USDC amount: "${amount_usdc}". Use a decimal string like "100.5".`);
        }

        if (qty < parseUnits("5", 6)) {
          return errorResponse("Minimum deposit is 5 USDC (enforced by the contract).");
        }

        const [locked, balance, [, , pendingQty]] = await Promise.all([
          client.readContract({
            address: GROWI_HF_VAULT_ADDRESS,
            abi: GROWI_HF_VAULT_ABI,
            functionName: "_lock",
          }),
          client.readContract({
            address: USDC_TOKEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          }),
          client.readContract({
            address: GROWI_HF_VAULT_ADDRESS,
            abi: GROWI_HF_VAULT_ABI,
            functionName: "pendingDeposits",
            args: [address],
          }),
        ]);

        if (locked) {
          const msg = await depositLock({ read: () => true }).catch(
            () => "Deposits are currently LOCKED. The vault locks every Sunday at 00:00 UTC and unlocks Monday at 00:20 UTC. Try again after the unlock.",
          );
          return errorResponse(msg);
        }

        if (pendingQty > 0n) {
          return errorResponse(
            `This wallet already has a pending deposit of ${formatUnits(pendingQty, 6)} USDC. The contract does not allow multiple simultaneous deposits. Wait for the owner to process it.`,
          );
        }

        if (balance < qty) {
          return errorResponse(
            `Insufficient USDC balance. Wallet has ${formatUnits(balance, 6)} USDC but deposit requires ${amount_usdc} USDC.`,
          );
        }

        const approveTx: PreparedTx = {
          to: USDC_TOKEN_ADDRESS,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [GROWI_HF_VAULT_ADDRESS, qty],
          }),
          description: `Approve ${amount_usdc} USDC for the GrowiHFVault`,
        };

        const depositTx: PreparedTx = {
          to: GROWI_HF_VAULT_ADDRESS,
          data: encodeFunctionData({
            abi: GROWI_HF_VAULT_ABI,
            functionName: "deposit",
            args: [qty],
          }),
          description: `Deposit ${amount_usdc} USDC into the GrowiHFVault`,
        };

        const transactions = [approveTx, depositTx];
        const gasEstimate = await estimateGasCost(transactions, address);

        const summary = [
          `Prepared deposit of ${amount_usdc} USDC for ${wallet}`,
          gasEstimate,
          "",
          "Transactions to sign (in order):",
          `  1. ${approveTx.description}`,
          `     → to: ${approveTx.to}`,
          `  2. ${depositTx.description}`,
          `     → to: ${depositTx.to}`,
          "",
          "After deposit, your USDC goes to the Hyperliquid vault leader. The vault owner will process the deposit and mint GWHF tokens to your wallet.",
          "",
          'Sign and broadcast these transactions using your own wallet client (bot private key, MetaMask, or any web3 signer). The Growi MCP server does not handle private keys.',
        ].join("\n");

        const result = { transactions, summary };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return errorResponse(`Error preparing deposit: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.tool(
    "prepare_withdraw",
    "Prepare unsigned transactions to withdraw GWHF from the GrowiHFVault. Returns approve + withdraw calldata ready to sign externally. The server does NOT handle private keys.",
    {
      amount_gwhf: z.string().describe("Amount of GWHF to withdraw (e.g. '50.0')"),
      wallet: z.string().describe("Withdrawer wallet address"),
    },
    async ({ amount_gwhf, wallet }) => {
      const versionBlock = checkVersionOrBlock();
      if (versionBlock) return errorResponse(versionBlock);

      try {
        const address = validateAddress(wallet);

        let qty: bigint;
        try {
          qty = parseUnits(amount_gwhf, 18);
        } catch {
          return errorResponse(`Invalid GWHF amount: "${amount_gwhf}". Use a decimal string like "50.0".`);
        }

        if (qty === 0n) {
          return errorResponse("Withdrawal amount must be greater than 0.");
        }

        const [balance, [, , pendingQty], withdrawLockMsg] = await Promise.all([
          client.readContract({
            address: GWHF_TOKEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          }),
          client.readContract({
            address: GROWI_HF_VAULT_ADDRESS,
            abi: GROWI_HF_VAULT_ABI,
            functionName: "pendingWithdrawals",
            args: [address],
          }),
          withdrawLock({ leaderAddress: HL_LEADER_ADDRESS, hlVaultId: HL_VAULT_ADDRESS }).catch(() => null),
        ]);

        if (balance < qty) {
          return errorResponse(
            `Insufficient GWHF balance. Wallet has ${formatUnits(balance, 18)} GWHF but withdrawal requires ${amount_gwhf} GWHF.`,
          );
        }

        let warning = "";
        if (pendingQty > 0n) {
          warning = `\n⚠ WARNING: This wallet already has a pending withdrawal of ${formatUnits(pendingQty, 18)} GWHF. The contract will REJECT this transaction. Wait for the owner to process the existing withdrawal first.\n`;
        }

        const lockNotice = withdrawLockMsg
          ? `\n${withdrawLockMsg.startsWith("Withdrawals are temporarily unavailable") ? "⚠ " : ""}${withdrawLockMsg}\n`
          : "";

        const approveTx: PreparedTx = {
          to: GWHF_TOKEN_ADDRESS,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [GROWI_HF_VAULT_ADDRESS, qty],
          }),
          description: `Approve ${amount_gwhf} GWHF for the GrowiHFVault`,
        };

        const withdrawTx: PreparedTx = {
          to: GROWI_HF_VAULT_ADDRESS,
          data: encodeFunctionData({
            abi: GROWI_HF_VAULT_ABI,
            functionName: "withdraw",
            args: [qty],
          }),
          description: `Withdraw ${amount_gwhf} GWHF from the GrowiHFVault`,
        };

        const transactions = [approveTx, withdrawTx];
        const gasEstimate = await estimateGasCost(transactions, address);

        const summary = [
          `Prepared withdrawal of ${amount_gwhf} GWHF for ${wallet}`,
          gasEstimate,
          warning,
          lockNotice,
          "Transactions to sign (in order):",
          `  1. ${approveTx.description}`,
          `     → to: ${approveTx.to}`,
          `  2. ${withdrawTx.description}`,
          `     → to: ${withdrawTx.to}`,
          "",
          "Important:",
          "- After submitting, your GWHF tokens are transferred to the vault and queued.",
          "- The vault owner will process the withdrawal and send USDC to your wallet.",
          "- Hyperliquid enforces a ~24h cooldown before the funds are available.",
          "",
          'Sign and broadcast these transactions using your own wallet client (bot private key, MetaMask, or any web3 signer). The Growi MCP server does not handle private keys.',
        ].join("\n");

        const result = { transactions, summary };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return errorResponse(`Error preparing withdrawal: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  if (signingAccount) {
    const walletClient = createWalletClient({
      account: signingAccount,
      chain: arbitrum,
      transport: http(),
    });

    server.tool(
      "execute_transaction",
      "Sign and broadcast transactions to Arbitrum using the locally configured wallet. Executes transactions sequentially and waits for each confirmation before sending the next. Use the output of prepare_deposit or prepare_withdraw as input.",
      {
        transactions: z
          .array(
            z.object({
              to: z.string().describe("Contract address"),
              data: z.string().describe("ABI-encoded calldata (hex)"),
              description: z.string().optional().describe("Human-readable description of the transaction"),
            }),
          )
          .describe("Ordered array of transactions to sign and broadcast (from prepare_deposit or prepare_withdraw)"),
      },
      async ({ transactions }) => {
        const versionBlock = checkVersionOrBlock();
        if (versionBlock) return errorResponse(versionBlock);

        try {
          const results: { hash: string; description: string }[] = [];

          for (const tx of transactions) {
            const toAddr = validateAddress(tx.to);
            const taggedData = `${tx.data}${MCP_CALLDATA_TAG}` as Hex;

            // Simulate via eth_call before signing — catches reverts without spending gas
            try {
              await client.call({
                account: signingAccount,
                to: toAddr,
                data: taggedData,
                value: 0n,
              });
            } catch (simError) {
              return errorResponse(
                [
                  `Simulation failed — transaction would revert: ${tx.description ?? tx.to}`,
                  `Reason: ${simError instanceof Error ? simError.message : String(simError)}`,
                  "",
                  "No gas was spent. Fix the issue and try again.",
                ].join("\n"),
              );
            }

            const txHash = await walletClient.sendTransaction({
              to: toAddr,
              data: taggedData,
              value: 0n,
            });

            const receipt = await client.waitForTransactionReceipt({ hash: txHash });

            if (receipt.status !== "success") {
              return errorResponse(
                [
                  `Transaction reverted: ${tx.description ?? tx.to}`,
                  `Hash: ${txHash}`,
                  `Arbiscan: https://arbiscan.io/tx/${txHash}`,
                ].join("\n"),
              );
            }

            results.push({ hash: txHash, description: tx.description ?? tx.to });
          }

          const txLines = results.map((r, i) =>
            [`${i + 1}. ${r.description}`, `   Hash: ${r.hash}`, `   Arbiscan: https://arbiscan.io/tx/${r.hash}`].join("\n"),
          );

          // After deposit: poll pendingDeposits for up to 60s to confirm owner processing.
          // Only runs when the executed list actually contained a deposit() call — avoids
          // a 60s "waiting for deposit" wait on approve-only executions when an unrelated
          // pending deposit happens to exist for the same wallet.
          const depositorAddress = signingAccount.address;
          let depositPollingResult = "";

          if (txListContainsDeposit(transactions)) {
            try {
              const [, , pendingQty] = await client.readContract({
                address: GROWI_HF_VAULT_ADDRESS,
                abi: GROWI_HF_VAULT_ABI,
                functionName: "pendingDeposits",
                args: [depositorAddress],
              });

              if (pendingQty > 0n) {
                depositPollingResult = "\nWaiting for deposit to be processed...";
                let processed = false;

                for (let i = 0; i < 6; i++) {
                  await new Promise((resolve) => setTimeout(resolve, 10_000));

                  const [, , qty] = await client.readContract({
                    address: GROWI_HF_VAULT_ADDRESS,
                    abi: GROWI_HF_VAULT_ABI,
                    functionName: "pendingDeposits",
                    args: [depositorAddress],
                  });

                  if (qty === 0n) {
                    processed = true;
                    depositPollingResult = "\n✓ Deposit processed — GWHF tokens have been minted to your wallet.";
                    break;
                  }
                }

                if (!processed) {
                  depositPollingResult = `\nDeposit is still in the queue after 60 seconds (pending: ${formatUnits(pendingQty, 6)} USDC). The owner will process it shortly. You can check later by asking "check my deposit".`;
                }
              }
            } catch {
              // Polling failed — don't block the response
            }
          }

          const lines = [
            `All ${results.length} transaction(s) confirmed on Arbitrum.`,
            "",
            ...txLines,
            depositPollingResult,
          ];

          return { content: [{ type: "text", text: lines.join("\n").trim() }] };
        } catch (e) {
          return errorResponse(`Error executing transaction: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
    );
  }
}
