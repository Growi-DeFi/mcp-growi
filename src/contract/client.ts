import { createPublicClient, http, type PublicClient } from "viem";
import { arbitrum } from "viem/chains";

export const GROWI_HF_VAULT_ADDRESS =
  "0x928ed672e6eabb7a565c5eb9aac15e3cf6a18388" as const;

export const GWHF_TOKEN_ADDRESS =
  "0x281f1c0ff11b9e977779b640e2b04df0df567cbd" as const;

export const USDC_TOKEN_ADDRESS =
  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;

// Growi leader EOA on Hyperliquid — `user` field for HL info queries.
export const HL_LEADER_ADDRESS =
  "0x7789450871Fb1315Fa982ccB8039cB34e8F2F60d" as const;

// Growi HL vault id — matches `delta.vault` in userNonFundingLedgerUpdates
// entries. Distinct from the leader EOA.
export const HL_VAULT_ADDRESS =
  "0x1e37a337ed460039d1b15bd3bc489de789768d5e" as const;

export function createArbitrumClient(): PublicClient {
  return createPublicClient({
    chain: arbitrum,
    transport: http(process.env.RPC_URL),
  });
}
