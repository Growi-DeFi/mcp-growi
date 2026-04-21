import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { depositLock, withdrawLock } from "../../src/locks/lock-period.ts";

const utc = (
	y: number,
	m: number,
	d: number,
	h = 0,
	mi = 0,
	s = 0,
	ms = 0,
): number => Date.UTC(y, m - 1, d, h, mi, s, ms);

const HOUR = 60 * 60 * 1000;

// April 2026 anchors: Apr 18 = Sat, Apr 19 = Sun, Apr 22 = Wed
const WED_1200 = utc(2026, 4, 22, 12, 0);
const SUN_1200 = utc(2026, 4, 19, 12, 0);

describe("depositLock", () => {
	test("locked: message is the fixed UTC schedule", async () => {
		const msg = await depositLock({
			read: async () => true,
			timezone: "UTC",
			now: WED_1200,
		});
		assert.match(msg, /Deposits are currently locked/);
		assert.match(msg, /Sunday 00:00 UTC → Monday 00:20 UTC/);
		assert.match(msg, /clear the 24-hour lockup/);
	});

	test("unlocked: message is open + schedule preview", async () => {
		const msg = await depositLock({
			read: async () => false,
			timezone: "UTC",
			now: WED_1200,
		});
		assert.match(msg, /Deposits are open/);
		assert.match(msg, /Sunday 00:00 UTC → Monday 00:20 UTC/);
	});

	test("sync reader is supported", async () => {
		const msg = await depositLock({ read: () => true, timezone: "UTC" });
		assert.match(msg, /currently locked/);
	});

	test("non-UTC timezone: UTC schedule + local equivalent with UTC±X suffix", async () => {
		const msg = await depositLock({
			read: async () => true,
			timezone: "America/New_York",
			now: WED_1200, // EDT is UTC-4 that week
		});
		assert.match(msg, /Sunday 00:00 UTC → Monday 00:20 UTC/);
		// Sun 00:00 UTC = Sat 20:00 EDT; Mon 00:20 UTC = Sun 20:20 EDT
		assert.match(msg, /\(Saturday 20:00 UTC-4 → Sunday 20:20 UTC-4\)/);
	});
});

describe("withdrawLock", () => {
	test("no blocking deposit (null): available", async () => {
		const msg = await withdrawLock({
			read: async () => null,
			timezone: "UTC",
			now: WED_1200,
		});
		assert.match(msg, /Withdrawals are available/);
		assert.match(msg, /5 minutes/);
		assert.match(msg, /1 USDC/);
	});

	test("blocking deposit 1h ago in UTC: dd-mm-yyyy format", async () => {
		const dep = WED_1200 - 1 * HOUR;
		const msg = await withdrawLock({
			read: async () => dep,
			timezone: "UTC",
			now: WED_1200,
		});
		assert.match(msg, /temporarily unavailable/);
		// Last deposit = 22-04-2026 11:00 UTC
		assert.match(msg, /22-04-2026 11:00 UTC/);
		// Unlock = 23-04-2026 11:00 UTC
		assert.match(msg, /23-04-2026 11:00 UTC/);
		// Schedule as fixed UTC text
		assert.match(msg, /Sunday 00:00 UTC → Monday 00:20 UTC/);
	});

	test("boundary — exactly 24h ago: available", async () => {
		const dep = WED_1200 - 24 * HOUR;
		assert.match(
			await withdrawLock({
				read: async () => dep,
				timezone: "UTC",
				now: WED_1200,
			}),
			/Withdrawals are available/,
		);
	});

	test("boundary — 24h - 1ms ago: still blocked", async () => {
		const dep = WED_1200 - 24 * HOUR + 1;
		assert.match(
			await withdrawLock({
				read: async () => dep,
				timezone: "UTC",
				now: WED_1200,
			}),
			/temporarily unavailable/,
		);
	});

	test("25h ago: already unlocked, available", async () => {
		const dep = WED_1200 - 25 * HOUR;
		assert.match(
			await withdrawLock({
				read: async () => dep,
				timezone: "UTC",
				now: WED_1200,
			}),
			/Withdrawals are available/,
		);
	});

	test("deposit 0 is treated as 'no deposit'", async () => {
		assert.match(
			await withdrawLock({
				read: async () => 0,
				timezone: "UTC",
				now: WED_1200,
			}),
			/Withdrawals are available/,
		);
	});

	test("Europe/Madrid: UTC+2 offset in local part", async () => {
		const dep = WED_1200 - 1 * HOUR; // 22-04-2026 11:00 UTC
		const msg = await withdrawLock({
			read: async () => dep,
			timezone: "Europe/Madrid",
			now: WED_1200,
		});
		assert.match(msg, /22-04-2026 11:00 UTC/); // UTC side
		assert.match(msg, /22-04-2026 13:00 UTC\+2/); // local side
	});

	test("America/New_York: UTC-4 offset in local part, date may shift", async () => {
		const dep = utc(2026, 4, 22, 2, 0); // 22-04-2026 02:00 UTC = 21-04-2026 22:00 EDT
		const msg = await withdrawLock({
			read: async () => dep,
			timezone: "America/New_York",
			now: WED_1200,
		});
		assert.match(msg, /22-04-2026 02:00 UTC/);
		assert.match(msg, /21-04-2026 22:00 UTC-4/);
	});

	test("Asia/Kolkata: fractional UTC+5:30 offset", async () => {
		const dep = WED_1200 - 1 * HOUR; // 22-04-2026 11:00 UTC
		const msg = await withdrawLock({
			read: async () => dep,
			timezone: "Asia/Kolkata",
			now: WED_1200,
		});
		assert.match(msg, /22-04-2026 11:00 UTC/);
		// 11:00 UTC + 5:30 = 16:30 IST
		assert.match(msg, /22-04-2026 16:30 UTC\+5:30/);
	});

	test("the 20-min margin: Sat 23:55 deposit unlocks before the batch ends", async () => {
		const dep = utc(2026, 4, 18, 23, 55);
		const msg = await withdrawLock({
			read: async () => dep,
			timezone: "UTC",
			now: SUN_1200,
		});
		assert.match(msg, /temporarily unavailable/);
		assert.match(msg, /18-04-2026 23:55 UTC/); // last deposit
		assert.match(msg, /19-04-2026 23:55 UTC/); // HL unlock
	});
});

describe("integration-ish", () => {
	test("depositLock: default reader throws when no RPC is reachable", async () => {
		await assert.rejects(
			() =>
				depositLock({
					rpcUrl: "http://127.0.0.1:1/invalid",
					now: WED_1200,
					timezone: "UTC",
				}),
			/fetch|ECONN|Arbitrum RPC/i,
		);
	});

	test("withdrawLock: default reader throws when HL is unreachable", async () => {
		await assert.rejects(
			() =>
				withdrawLock({
					hlInfoUrl: "http://127.0.0.1:1/invalid",
					now: WED_1200,
					timezone: "UTC",
				}),
			/fetch|ECONN|Hyperliquid/i,
		);
	});
});
