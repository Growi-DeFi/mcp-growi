import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Account } from "viem";
import { registerReadTools } from "./read.js";
import { registerWriteTools } from "./write.js";

export interface VersionStatus {
  outdated: boolean;
  localVersion: string;
  latestVersion: string | null;
  message: string | null;
}

export function registerTools(server: McpServer, signingAccount: Account | null, versionStatus: VersionStatus): void {
  registerReadTools(server, versionStatus);
  registerWriteTools(server, signingAccount, versionStatus);
}
