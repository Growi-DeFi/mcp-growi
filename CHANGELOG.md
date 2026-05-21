# Changelog

All notable changes to `mcp-growi` will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project follows [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-05-22

**Security release.** Hardens `execute_transaction` against prompt-injection attacks, tightens the version-gate to fail closed, and ships full supply-chain hygiene so downstream installs receive a locked, vuln-free dependency tree.

### Security
- **Allowlist for `execute_transaction`.** Only signs transactions calling one of four `(contract, selector)` pairs: `USDC.approve`, `GWHF.approve`, `vault.deposit`, `vault.withdraw`. Other calls are rejected before signing.
- **ABI-decoded argument validation.** `approve` is accepted only when the spender is the GrowiHFVault address; `deposit` and `withdraw` amounts must be greater than zero.
- **Fail-closed version check across all tools.** Every read and write tool now requires successful version verification against the npm registry. Any failure — outdated local version, registry HTTP error, missing `version` field, or network/timeout — blocks all tool calls until verification succeeds. Previously only writes were gated, and several failure paths failed open.
- **Redacted keystore path in logs.** `loadSigningAccount()` now logs only the keystore filename (via `path.basename`) instead of the full filesystem path.
- **README Security section.** Documents the LLM-as-confused-deputy trust model and recommends a dedicated low-balance "bot" wallet for any keystore configuration.

### Supply chain
- **All direct dependencies exact-pinned.** `@modelcontextprotocol/sdk@1.29.0`, `viem@2.47.17`, `zod@4.3.6`. No caret ranges anywhere in the install graph.
- **Transitive CVE patches via `overrides`.** Forces `hono@4.12.18`, `fast-uri@3.1.2` (path-traversal + host-confusion fixes), `ip-address@10.2.0` (Address6 XSS fix), `ws@8.20.1` (uninitialized memory disclosure fix) regardless of what parent packages declare.
- **`npm-shrinkwrap.json` shipped.** Locks the full transitive tree for downstream consumers — installing `mcp-growi@0.2.0` produces a bit-identical tree on any machine, and `npm audit` returns 0 vulnerabilities.
- **`.npmrc` policy file.** Sets `min-release-age=7` (cooldown against rushed-release supply-chain attacks), `ignore-scripts=true` (no lifecycle script execution on install), `audit-level=high`, `save-exact=true`.
- **Dev dependencies pinned.** `@types/node@22.19.17`, `typescript@5.9.3`.

### Added
- Network-free allowlist smoke test (`tests/allowlist/check.ts`, 12/12 passing).

### Changed
- `prepare_deposit` and `prepare_withdraw` now reject non-integer amount strings (e.g. `"100.5"`). Pass whole-number strings like `"100"` instead.
- Version-check timeout raised from 5s to 10s.

## [0.1.1] - 2026-04-21

### Added
- `mcpName` field in `package.json` for MCP Registry discovery.

## [0.1.0] - 2026-04-21

Initial release.
