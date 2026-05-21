# mcp-growi

MCP (Model Context Protocol) server for [Growi Finance](https://growi.fi) — enables AI agents and autonomous bots to interact programmatically with the **GrowiHFVault** smart contract on Arbitrum.

## Security

**Read this before configuring a keystore or private key.**

`mcp-growi` exposes `execute_transaction`, which signs and broadcasts Arbitrum transactions with the locally configured wallet. Inside any MCP client (Claude Desktop, Claude Code, etc.) **the LLM has full authority over what gets signed** — every tool call is initiated by the model in response to your prompts *and* anything else it has access to.

This makes the MCP a "confused deputy": if untrusted content reaches the model — a web page fetched by another tool, a document opened in the session, a sibling MCP server controlled by an attacker — a prompt-injection payload inside that content can instruct the model to drain the configured wallet.

### Recommendations

- **Do not configure `KEYSTORE_PATH` or `PRIVATE_KEY` in a session that has access to untrusted content.** If the same client has browsing tools, document-readers, or any other MCP server, treat the session as compromised by default.
- **Use a dedicated "bot" wallet.** Create a fresh Ethereum address solely for `mcp-growi` and fund it only with the amount you intend to deposit. Never reuse your main custody wallet.
- **Keep ETH for gas low.** A few dollars' worth is enough — there is no upside to holding more on the bot wallet than the next operation needs.
- **Run `mcp-growi@latest`.** When a security release is published, the built-in version check blocks all operations until you upgrade. Pinning to an older version defeats this.

### What this server does enforce

The server has its own defenses against the most direct drain paths, but they cannot prevent every form of misuse:

- **Allowlist.** `execute_transaction` only signs calls to four `(contract, selector)` pairs — `USDC.approve`, `GWHF.approve`, `vault.deposit`, `vault.withdraw`. A prompt-injection payload calling `USDC.transfer(attacker, balance)` is rejected before signing.
- **Decoded validation.** `approve` calls are accepted only when the spender is the GrowiHFVault address. `deposit` and `withdraw` amounts must be greater than zero.
- **Version gate.** All read and write tools refuse to operate when the local MCP version cannot be verified against the npm registry, or does not match the latest published version.

These guards close the easy attacks but do not make the keystore safe in arbitrary sessions. Treat it as a hot wallet, not custody.

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
    ├── read.ts            # Read-only on-chain queries
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

> **Important:** use `mcp-growi@latest` (not just `mcp-growi`) to ensure the MCP auto-updates every time Claude starts. If your version is outdated, or the npm registry is unreachable, all tools (read and write) will be blocked until verification succeeds.

**Alternative — plain private key (less secure):**
```json
"env": { "PRIVATE_KEY": "0x..." }
```

**Optional — custom RPC endpoint:**
```json
"env": { "RPC_URL": "https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY" }
```

Restart Claude Desktop/Code after saving. The tools will be available once the version check passes — if calls return a version-block error, see the Security section above.

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
