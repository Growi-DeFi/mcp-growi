# mcp-growi

MCP (Model Context Protocol) server for [Growi Finance](https://growi.fi) — enables AI agents and autonomous bots to interact programmatically with the **GrowiHFVault** smart contract on Arbitrum.

## Contract details

| Field | Value |
|-------|-------|
| Network | Arbitrum One |
| Contract | `0x928ed672e6eabb7a565c5eb9aac15e3cf6a18388` |
| Vault token | GWHF |
| Deposit token | USDC |

The contract is verified on Arbiscan — you can check the source code and ABI at:
https://arbiscan.io/address/0x928ed672e6eabb7a565c5eb9aac15e3cf6a18388#code

The ABI is included in this package (`src/contract/abi.ts`) so no external calls are needed at runtime.

## Project structure

```
src/
├── index.ts               # Server entrypoint + npm version check
├── contract/              # On-chain interaction layer (viem)
│   ├── abi.ts             # GrowiHFVault + ERC20 ABIs
│   ├── client.ts          # Arbitrum public client + contract/token/HL addresses
│   └── index.ts
├── locks/
│   └── lock-period.ts     # Arbitrum deposit lock + Hyperliquid 24h withdraw lockup
└── tools/                 # MCP tool definitions
    ├── read.ts            # Read-only tools (balances, price, lock status)
    ├── write.ts           # Transaction prep + signing (keystore/privkey)
    └── index.ts
```

## Setup — Claude Desktop / Claude Code

Add the following to your Claude MCP config (`claude_desktop_config.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "growi": {
      "command": "npx",
      "args": ["-y", "mcp-growi@latest"],
      "env": {
        "KEYSTORE_PATH": "/path/to/your/wallet.json",
        "KEYSTORE_PASSPHRASE": "your_passphrase"
      }
    }
  }
}
```

> **Important:** use `mcp-growi@latest` (not just `mcp-growi`) to ensure the MCP auto-updates every time Claude starts. If your version is outdated, write operations (deposits, withdrawals) will be blocked until you update.

**Alternative — plain private key (less secure):**
```json
"env": { "PRIVATE_KEY": "0x..." }
```

**Optional — custom RPC endpoint:**
```json
"env": { "RPC_URL": "https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY" }
```

Restart Claude Desktop/Code after saving. You should see `get_vault_status` and other tools available.

## Setup — development (from source)

```bash
npm install
npm run build
npm start
```

## Tech stack

- **TypeScript + Node.js**
- **@modelcontextprotocol/sdk** — MCP server implementation
- **viem** — Ethereum/Arbitrum RPC interactions
