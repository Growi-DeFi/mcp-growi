import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatUnits, type Address, isAddress } from "viem";
import {
  createArbitrumClient,
  GROWI_HF_VAULT_ADDRESS,
  GWHF_TOKEN_ADDRESS,
  USDC_TOKEN_ADDRESS,
  HL_LEADER_ADDRESS,
  HL_VAULT_ADDRESS,
} from "../contract/index.js";
import { GROWI_HF_VAULT_ABI, ERC20_ABI } from "../contract/index.js";
import { depositLock, withdrawLock } from "../locks/lock-period.js";
import type { VersionStatus } from "./index.js";

const client = createArbitrumClient();

function validateAddress(wallet: string): Address {
  if (!isAddress(wallet)) {
    throw new Error(`Invalid Ethereum address: ${wallet}`);
  }
  return wallet as Address;
}

function errorResponse(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function registerReadTools(server: McpServer, versionStatus: VersionStatus): void {
  // Block read operations if MCP version cannot be verified or is outdated (security: ABI or contract address may have changed)
  function checkVersionOrBlock(): string | null {
    if (versionStatus.outdated && versionStatus.message) {
      return versionStatus.message;
    }
    return null;
  }

  server.tool(
    "get_vault_status",
    "Check if GrowiHFVault deposits are currently locked or open. Includes context about the weekly lock/unlock cycle.",
    {},
    async () => {
      const versionBlock = checkVersionOrBlock();
      if (versionBlock) return errorResponse(versionBlock);

      try {
        const locked = await client.readContract({
          address: GROWI_HF_VAULT_ADDRESS,
          abi: GROWI_HF_VAULT_ABI,
          functionName: "_lock",
        });

        const status = locked ? "LOCKED" : "OPEN";
        const text = [
          `Deposit status: ${status}`,
          "",
          locked
            ? "Deposits are currently locked. The vault locks every Sunday at 00:00 UTC while strategies execute."
            : "Deposits are currently open. You can deposit USDC into the vault.",
          "",
          "Weekly cycle:",
          "- Lock: Sunday 00:00 UTC",
          "- Unlock: Monday 00:20 UTC",
          "",
          "Note: Withdrawals are not affected by the lock — they can be initiated at any time, but require ~24h for Hyperliquid to process.",
        ].join("\n");

        return { content: [{ type: "text", text }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `RPC error reading vault lock status: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_pending_deposit",
    "Check if a wallet has a pending deposit in the GrowiHFVault queue.",
    { wallet: z.string().describe("Ethereum address to check") },
    async ({ wallet }) => {
      const versionBlock = checkVersionOrBlock();
      if (versionBlock) return errorResponse(versionBlock);

      let address: Address;
      try { address = validateAddress(wallet); }
      catch (e) { return errorResponse(errMsg(e)); }

      try {
        const [, , qty] = await client.readContract({
          address: GROWI_HF_VAULT_ADDRESS,
          abi: GROWI_HF_VAULT_ABI,
          functionName: "pendingDeposits",
          args: [address],
        });

        const formatted = formatUnits(qty, 6);
        const hasPending = qty > 0n;

        const text = hasPending
          ? `Pending deposit for ${wallet}: ${formatted} USDC\n\nThis deposit is queued and waiting for the vault owner to process it (mint GWHF tokens).`
          : `No pending deposit for ${wallet}.`;

        return { content: [{ type: "text", text }] };
      } catch (e) {
        return errorResponse(`RPC error reading pending deposits: ${errMsg(e)}`);
      }
    },
  );

  server.tool(
    "get_pending_withdrawal",
    "Check if a wallet has a pending withdrawal in the GrowiHFVault queue.",
    { wallet: z.string().describe("Ethereum address to check") },
    async ({ wallet }) => {
      const versionBlock = checkVersionOrBlock();
      if (versionBlock) return errorResponse(versionBlock);

      let address: Address;
      try { address = validateAddress(wallet); }
      catch (e) { return errorResponse(errMsg(e)); }

      try {
        const [, , qty] = await client.readContract({
          address: GROWI_HF_VAULT_ADDRESS,
          abi: GROWI_HF_VAULT_ABI,
          functionName: "pendingWithdrawals",
          args: [address],
        });

        const formatted = formatUnits(qty, 18);
        const hasPending = qty > 0n;

        const text = hasPending
          ? `Pending withdrawal for ${wallet}: ${formatted} GWHF\n\nThis withdrawal is queued. The vault owner will process it and send USDC. Hyperliquid enforces a ~24h cooldown before funds are available.`
          : `No pending withdrawal for ${wallet}.`;

        return { content: [{ type: "text", text }] };
      } catch (e) {
        return errorResponse(`RPC error reading pending withdrawals: ${errMsg(e)}`);
      }
    },
  );

  server.tool(
    "get_usdc_balance",
    "Get the USDC balance of a wallet on Arbitrum.",
    { wallet: z.string().describe("Ethereum address to check") },
    async ({ wallet }) => {
      const versionBlock = checkVersionOrBlock();
      if (versionBlock) return errorResponse(versionBlock);

      let address: Address;
      try { address = validateAddress(wallet); }
      catch (e) { return errorResponse(errMsg(e)); }

      try {
        const balance = await client.readContract({
          address: USDC_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        });

        const formatted = formatUnits(balance, 6);
        return { content: [{ type: "text", text: `USDC balance for ${wallet}: ${formatted} USDC` }] };
      } catch (e) {
        return errorResponse(`RPC error reading USDC balance: ${errMsg(e)}`);
      }
    },
  );

  server.tool(
    "get_eth_balance",
    "Get the ETH balance of a wallet on Arbitrum. ETH is needed to pay gas fees for transactions.",
    { wallet: z.string().describe("Ethereum address to check") },
    async ({ wallet }) => {
      const versionBlock = checkVersionOrBlock();
      if (versionBlock) return errorResponse(versionBlock);

      let address: Address;
      try { address = validateAddress(wallet); }
      catch (e) { return errorResponse(errMsg(e)); }

      try {
        const balance = await client.getBalance({ address });

        const formatted = formatUnits(balance, 18);
        return { content: [{ type: "text", text: `ETH balance for ${wallet}: ${formatted} ETH` }] };
      } catch (e) {
        return errorResponse(`RPC error reading ETH balance: ${errMsg(e)}`);
      }
    },
  );

  server.tool(
    "get_gwhf_balance",
    "Get the GWHF (Growi vault shares) balance of a wallet on Arbitrum.",
    { wallet: z.string().describe("Ethereum address to check") },
    async ({ wallet }) => {
      const versionBlock = checkVersionOrBlock();
      if (versionBlock) return errorResponse(versionBlock);

      let address: Address;
      try { address = validateAddress(wallet); }
      catch (e) { return errorResponse(errMsg(e)); }

      try {
        const balance = await client.readContract({
          address: GWHF_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        });

        const formatted = formatUnits(balance, 18);
        return { content: [{ type: "text", text: `GWHF balance for ${wallet}: ${formatted} GWHF` }] };
      } catch (e) {
        return errorResponse(`RPC error reading GWHF balance: ${errMsg(e)}`);
      }
    },
  );

  server.tool(
    "get_usdc_allowance",
    "Check how much USDC a wallet has approved for the GrowiHFVault to spend.",
    { wallet: z.string().describe("Ethereum address (token owner) to check") },
    async ({ wallet }) => {
      const versionBlock = checkVersionOrBlock();
      if (versionBlock) return errorResponse(versionBlock);

      let address: Address;
      try { address = validateAddress(wallet); }
      catch (e) { return errorResponse(errMsg(e)); }

      try {
        const allowance = await client.readContract({
          address: USDC_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, GROWI_HF_VAULT_ADDRESS],
        });

        const formatted = formatUnits(allowance, 6);
        const text = allowance > 0n
          ? `USDC allowance for vault from ${wallet}: ${formatted} USDC`
          : `No USDC allowance set for the vault from ${wallet}. An approve transaction is needed before depositing.`;

        return { content: [{ type: "text", text }] };
      } catch (e) {
        return errorResponse(`RPC error reading USDC allowance: ${errMsg(e)}`);
      }
    },
  );

  server.tool(
    "get_gwhf_price",
    "Calculate the current GWHF token price. Derives it from the leader's equity in the Hyperliquid vault divided by GWHF total supply.",
    {},
    async () => {
      const versionBlock = checkVersionOrBlock();
      if (versionBlock) return errorResponse(versionBlock);

      try {
        const [totalSupplyRaw, hlResponse] = await Promise.all([
          client.readContract({
            address: GWHF_TOKEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: "totalSupply",
          }),
          fetch("https://api.hyperliquid.xyz/info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "userVaultEquities", user: HL_LEADER_ADDRESS }),
          }),
        ]);

        if (!hlResponse.ok) {
          return {
            content: [{ type: "text", text: `Hyperliquid API error: HTTP ${hlResponse.status}` }],
            isError: true,
          };
        }

        const vaultEquities = await hlResponse.json() as { vaultAddress: string; equity: string }[];
        const leaderEntry = vaultEquities.find(
          (v) => v.vaultAddress.toLowerCase() === HL_VAULT_ADDRESS.toLowerCase(),
        );

        if (!leaderEntry) {
          return {
            content: [{ type: "text", text: "Could not find leader's equity in the Growi HF vault on Hyperliquid." }],
            isError: true,
          };
        }

        const totalSupply = Number(formatUnits(totalSupplyRaw as bigint, 18));

        if (totalSupply === 0) {
          return {
            content: [{ type: "text", text: "GWHF total supply is 0 — cannot calculate price." }],
            isError: true,
          };
        }

        const leaderEquity = parseFloat(leaderEntry.equity);
        const price = leaderEquity / totalSupply;

        const text = [
          `GWHF token price: $${price.toFixed(4)}`,
          "",
          `Leader equity in vault: $${leaderEquity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          `GWHF total supply: ${totalSupply.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          "",
          "Formula: price = leader_equity / total_supply",
          "Source: Hyperliquid userVaultEquities API + GWHF on-chain totalSupply",
        ].join("\n");

        return { content: [{ type: "text", text }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error calculating GWHF price: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_lock_status",
    "Check the current status of both lock periods: the weekly Arbitrum deposit lock and the 24h Hyperliquid withdrawal lock. Use this when a user asks why they cannot deposit or withdraw right now.",
    {},
    async () => {
      const versionBlock = checkVersionOrBlock();
      if (versionBlock) return errorResponse(versionBlock);

      try {
        const [depositMsg, withdrawMsg] = await Promise.all([
          depositLock({ vaultAddress: GROWI_HF_VAULT_ADDRESS }),
          withdrawLock({ leaderAddress: HL_LEADER_ADDRESS, hlVaultId: HL_VAULT_ADDRESS }),
        ]);

        const text = [
          "Deposit lock (Arbitrum vault):",
          `  ${depositMsg}`,
          "",
          "Withdrawal lock (Hyperliquid 24h lockup):",
          `  ${withdrawMsg}`,
        ].join("\n");

        return { content: [{ type: "text", text }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error checking lock status: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    },
  );
}
