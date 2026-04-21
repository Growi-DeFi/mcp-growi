/**
 * ABI for GrowiHFVault contract on Arbitrum
 * Source: Sourcify full match
 * Address: 0x928ed672e6eabb7a565c5eb9aac15e3cf6a18388
 */
export const GROWI_HF_VAULT_ABI = [
  {
    inputs: [
      { internalType: "address", name: "hlVaultLeader_", type: "address" },
      { internalType: "address", name: "hlBridge_", type: "address" },
      { internalType: "address", name: "hfToken_", type: "address" },
      { internalType: "address", name: "paymentToken_", type: "address" },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [{ internalType: "address", name: "target", type: "address" }],
    name: "AddressEmptyCode",
    type: "error",
  },
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "AddressInsufficientBalance",
    type: "error",
  },
  {
    inputs: [],
    name: "FailedInnerCall",
    type: "error",
  },
  {
    inputs: [{ internalType: "address", name: "token", type: "address" }],
    name: "SafeERC20FailedOperation",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "sender", type: "address" },
      { indexed: false, internalType: "uint256", name: "qty", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "timestamp", type: "uint256" },
    ],
    name: "Deposit",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "receiver", type: "address" },
      { indexed: false, internalType: "uint256", name: "qty", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "timestamp", type: "uint256" },
    ],
    name: "GrowiHFMinted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "receiver", type: "address" },
      { indexed: false, internalType: "uint256", name: "qty", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "timestamp", type: "uint256" },
    ],
    name: "PaymentReceived",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "sender", type: "address" },
      { indexed: false, internalType: "uint256", name: "qty", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "timestamp", type: "uint256" },
    ],
    name: "Withdraw",
    type: "event",
  },
  {
    inputs: [],
    name: "_lock",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "qty", type: "uint256" }],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "qty", type: "uint256" },
      { internalType: "address", name: "depositor", type: "address" },
    ],
    name: "emitDeposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "qty", type: "uint256" },
      { internalType: "address", name: "withdrawer", type: "address" },
    ],
    name: "emitWithdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "lock",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "pendingDeposits",
    outputs: [
      { internalType: "address", name: "prev", type: "address" },
      { internalType: "address", name: "next", type: "address" },
      { internalType: "uint256", name: "qty", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "pendingWithdrawals",
    outputs: [
      { internalType: "address", name: "prev", type: "address" },
      { internalType: "address", name: "next", type: "address" },
      { internalType: "uint256", name: "qty", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "unlock",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "qty", type: "uint256" }],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/**
 * Standard ERC-20 ABI subset for interacting with GWHF and USDC tokens
 */
export const ERC20_ABI = [
  {
    inputs: [],
    name: "name",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalSupply",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "address", name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "value", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
