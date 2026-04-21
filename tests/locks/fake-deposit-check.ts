// Simulates a vault deposit made RIGHT NOW and renders depositLock /
// withdrawLock messages across multiple timezones so the format and the
// date/offset rendering can be eyeballed.
//
// Run: npx tsx fake-deposit-check.ts

import { depositLock, withdrawLock } from "../../src/locks/lock-period.ts";

const now = Date.now();
const fakeDeposit = now; // "has been just made"

const zones = [
	"UTC",
	"Europe/Madrid",
	"America/New_York",
	"Asia/Tokyo",
	"Asia/Kolkata",
];

console.log(`Scenario: vault deposit at ${new Date(now).toISOString()}`);
console.log(
	`  (injected via the test reader; _lock assumed false for the demo)\n`,
);

async function main() {
	for (const tz of zones) {
		console.log(`══════════ ${tz} ══════════`);
		const d = await depositLock({ read: () => false, timezone: tz, now });
		const w = await withdrawLock({
			read: () => fakeDeposit,
			timezone: tz,
			now,
		});
		console.log("depositLock:");
		console.log("  " + d);
		console.log("withdrawLock:");
		console.log("  " + w);
		console.log();
	}
}

main().catch((err) => {
	console.error("FAILED:", err);
	process.exit(1);
});
