// Live smoke test: hits Arbitrum RPC + Hyperliquid info API with default
// config and prints the resolved state + the public-facing messages.
//
// Run: npx tsx live-check.ts
// Optional TZ override: TZ=Europe/Madrid npx tsx live-check.ts

import { depositLock, withdrawLock } from "../../src/locks/lock-period.ts";

const VAULT_ADDRESS = "0x928ed672e6Eabb7A565c5eB9aAC15e3Cf6A18388";
const LEADER_ADDRESS = "0x7789450871Fb1315Fa982ccB8039cB34e8F2F60d";
const HL_VAULT_ID = "0x1e37a337ed460039d1b15bd3bc489de789768d5e";
const RPC_URL = "https://arb1.arbitrum.io/rpc";
const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
const LOCK_SELECTOR = "0x4bd724ed";

const HOUR_MS = 60 * 60 * 1000;

const tz =
	process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
const now = Date.now();

function hr(label: string) {
	console.log(`\n=== ${label} ===`);
}

async function probeContract() {
	hr("Arbitrum eth_call  GrowiHFVault._lock()");
	const res = await fetch(RPC_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "eth_call",
			params: [{ to: VAULT_ADDRESS, data: LOCK_SELECTOR }, "latest"],
		}),
	});
	const json = (await res.json()) as {
		result?: string;
		error?: { message: string };
	};
	console.log("raw result:  ", json.result ?? json.error);
	if (json.result) {
		const locked = BigInt(json.result) === 1n;
		console.log("decoded bool:", locked);
	}
}

async function probeHyperliquid() {
	hr("Hyperliquid  userNonFundingLedgerUpdates (leader, last 24h)");
	const startTime = now - 24 * HOUR_MS;
	const res = await fetch(HL_INFO_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			type: "userNonFundingLedgerUpdates",
			user: LEADER_ADDRESS,
			startTime,
		}),
	});
	if (!res.ok) {
		console.log("HTTP error:", res.status, await res.text());
		return;
	}
	const entries = (await res.json()) as Array<{
		time: number;
		hash?: string;
		delta?: { type?: string; vault?: string; usdc?: string };
	}>;
	console.log(`total entries in last 24h: ${entries.length}`);

	const vaultDeposits = entries.filter(
		(e) =>
			e?.delta?.type === "vaultDeposit" &&
			typeof e.delta.vault === "string" &&
			e.delta.vault.toLowerCase() === HL_VAULT_ID.toLowerCase(),
	);
	console.log(`vaultDeposit entries for Growi vault: ${vaultDeposits.length}`);
	for (const e of vaultDeposits) {
		console.log(
			`  time=${new Date(e.time).toISOString()}  usdc=${e.delta?.usdc}  hash=${e.hash}`,
		);
	}
	if (vaultDeposits.length > 0) {
		const lastTs = Math.max(...vaultDeposits.map((e) => Number(e.time)));
		const unlockTs = lastTs + 24 * HOUR_MS;
		console.log(`last deposit:   ${new Date(lastTs).toISOString()}`);
		console.log(
			`HL unlock at:   ${new Date(unlockTs).toISOString()}  ` +
				`(${now < unlockTs ? "STILL BLOCKING" : "already unlocked"})`,
		);
	} else {
		console.log("no deposits in last 24h → withdrawals should be available");
	}
}

async function printPublicMessages() {
	hr(`depositLock()  (timezone=${tz})`);
	console.log(await depositLock({ timezone: tz, now }));

	hr(`withdrawLock()  (timezone=${tz})`);
	console.log(await withdrawLock({ timezone: tz, now }));
}

async function main() {
	console.log(`now=${new Date(now).toISOString()}  tz=${tz}`);
	await probeContract();
	await probeHyperliquid();
	await printPublicMessages();
}

main().catch((err) => {
	console.error("FAILED:", err);
	process.exit(1);
});
