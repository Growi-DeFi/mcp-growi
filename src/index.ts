#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Account } from "viem";
import { registerTools, type VersionStatus } from "./tools/index.js";
import { loadSigningAccount } from "./tools/write.js";

// ── Version check against npm registry ──────────────────────────────────────

function getLocalVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function checkVersion(localVersion: string): Promise<VersionStatus> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch("https://registry.npmjs.org/mcp-growi/latest", {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      // Package not yet published or registry error — don't block
      return { outdated: false, localVersion, latestVersion: null, message: null };
    }

    const data = await res.json() as { version?: string };
    const latestVersion = data.version ?? null;

    if (!latestVersion) {
      return { outdated: false, localVersion, latestVersion: null, message: null };
    }

    if (latestVersion !== localVersion) {
      return {
        outdated: true,
        localVersion,
        latestVersion,
        message: `⚠ You are running MCP version ${localVersion}, but version ${latestVersion} is required. Write operations are blocked for safety. Update with: npm install -g mcp-growi@latest`,
      };
    }

    return { outdated: false, localVersion, latestVersion, message: null };
  } catch {
    // Network error, offline, timeout — don't block, but warn
    console.error("[growi-mcp] Could not verify version against npm registry — proceeding without check.");
    return { outdated: false, localVersion, latestVersion: null, message: null };
  }
}

function createServer(signingAccount: Account | null, versionStatus: VersionStatus): McpServer {
  const server = new McpServer({
    name: "mcp-growi",
    version: versionStatus.localVersion,
  });
  registerTools(server, signingAccount, versionStatus);
  return server;
}

async function main(): Promise<void> {
  const localVersion = getLocalVersion();
  const [signingAccount, versionStatus] = await Promise.all([
    loadSigningAccount(),
    checkVersion(localVersion),
  ]);

  if (versionStatus.outdated) {
    console.error(`[growi-mcp] ⚠ Version outdated: local ${versionStatus.localVersion} → latest ${versionStatus.latestVersion}. Write operations blocked.`);
  } else if (versionStatus.latestVersion) {
    console.error(`[growi-mcp] Version ${localVersion} is up to date.`);
  }

  const server = createServer(signingAccount, versionStatus);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
