// Weekly deposit-lock window for GrowiHFVault + Hyperliquid withdraw lockup.
//
// Hyperliquid locks every leader-EOA vault deposit for 24h before it can be
// withdrawn. To guarantee a clean weekly withdrawal window, the Arbitrum
// contract pauses deposits every Sunday 00:00 UTC until Monday 00:20 UTC
// (24h HL lockup + 20min margin). The margin lets the last pre-pause deposit
// clear the lockup before deposits reopen, so all queued withdrawals are
// processable in the same window.
//
// `depositLock` reads the contract's `_lock` boolean. `withdrawLock` reads the
// Growi leader's last vault deposit from Hyperliquid's info API; if it's
// within the 24h HL lockup, withdrawals are blocked until that moment.
//
// TODO(lit-v3): once on-demand withdrawals ship per
// LitProtocol/plan/03-flow-withdraw.md the weekly window goes away and the
// withdraw flow becomes coordinator-paced. Much of this file can be deleted.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HL_DEPOSIT_LOCK_MS = 24 * HOUR_MS;
const BRIDGE_TIME_MIN = 5;
const BRIDGE_FEE_USDC = 1;
// 24h is sufficient: any vault deposit older than 24h has already cleared
// Hyperliquid's lockup and can no longer block withdrawals.
const HL_LOOKBACK_MS = 24 * HOUR_MS;

const SCHEDULE_UTC = "Sunday 00:00 UTC → Monday 00:20 UTC";
const MARGIN_MINUTES = 20;

// GrowiHFVault on Arbitrum One (source: LitProtocol/contract-source.md).
const DEFAULT_VAULT_ADDRESS = "0x928ed672e6Eabb7A565c5eB9aAC15e3Cf6A18388";
// Growi leader EOA — the `user` field for HL ledger queries.
const DEFAULT_LEADER_ADDRESS = "0x7789450871Fb1315Fa982ccB8039cB34e8F2F60d";
// HL vault id — distinct from the leader EOA. This is the address that
// appears in `delta.vault` of `vaultDeposit` ledger entries.
const DEFAULT_HL_VAULT_ID = "0x1e37a337ed460039d1b15bd3bc489de789768d5e";
const DEFAULT_RPC_URL = "https://arb1.arbitrum.io/rpc";
const DEFAULT_HL_INFO_URL = "https://api.hyperliquid.xyz/info";

// keccak256("_lock()").slice(0, 10)
const LOCK_SELECTOR = "0x4bd724ed";

type BaseOpts = {
	timezone?: string; // IANA TZ id; defaults to process system TZ
	now?: number; // UNIX ms; defaults to Date.now() (for testability)
};

export type DepositLockOpts = BaseOpts & {
	read?: () => Promise<boolean> | boolean;
	rpcUrl?: string;
	vaultAddress?: string;
};

export type WithdrawLockOpts = BaseOpts & {
	read?: () => Promise<number | null> | number | null;
	hlInfoUrl?: string;
	leaderAddress?: string; // EOA queried as `user` in the ledger call
	hlVaultId?: string; // vault id filtered on in `delta.vault`
};

export async function depositLock(opts: DepositLockOpts = {}): Promise<string> {
	const tz = resolveTz(opts.timezone);
	const now = opts.now ?? Date.now();

	const locked = opts.read
		? await opts.read()
		: await fetchVaultLock(
				opts.rpcUrl ?? DEFAULT_RPC_URL,
				opts.vaultAddress ?? DEFAULT_VAULT_ADDRESS,
			);

	const schedule = formatSchedule(now, tz);

	if (locked) {
		return (
			`Deposits are currently locked. The weekly pause runs ${schedule}. ` +
			`The pause lets all pending Hyperliquid deposits clear the 24-hour lockup so queued withdrawals can be processed. ` +
			`Sorry for the inconvenience.`
		);
	}
	return `Deposits are open. Weekly pause schedule: ${schedule}.`;
}

export async function withdrawLock(
	opts: WithdrawLockOpts = {},
): Promise<string> {
	const tz = resolveTz(opts.timezone);
	const now = opts.now ?? Date.now();

	const leader = opts.leaderAddress ?? DEFAULT_LEADER_ADDRESS;
	const vaultId = opts.hlVaultId ?? DEFAULT_HL_VAULT_ID;

	const lastDepositTs = opts.read
		? await opts.read()
		: await fetchLastLeaderVaultDeposit(
				opts.hlInfoUrl ?? DEFAULT_HL_INFO_URL,
				leader,
				vaultId,
				now,
			);

	const blocking =
		lastDepositTs != null &&
		lastDepositTs > 0 &&
		now < lastDepositTs + HL_DEPOSIT_LOCK_MS;

	if (!blocking) {
		return (
			`Withdrawals are available. Bridging USDC from Hyperliquid to Arbitrum ` +
			`takes ~${BRIDGE_TIME_MIN} minutes and a ${BRIDGE_FEE_USDC} USDC Hyperliquid fee.`
		);
	}

	const hlUnlockTs = lastDepositTs! + HL_DEPOSIT_LOCK_MS;
	return (
		`Withdrawals are temporarily unavailable due to Hyperliquid's 24-hour vault lockup. ` +
		`Growi leader's last vault deposit: ${formatMoment(new Date(lastDepositTs!), tz)}; ` +
		`it unlocks on Hyperliquid at ${formatMoment(new Date(hlUnlockTs), tz)}. ` +
		`Withdrawals submitted now will be queued for the next weekly batch — ${formatSchedule(now, tz)}. ` +
		`Your USDC payout uses the execution price, not the order price.`
	);
}

// ---------------- formatting ----------------

function resolveTz(tz?: string): string {
	return tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

function formatSchedule(now: number, tz: string): string {
	if (tz === "UTC") return SCHEDULE_UTC;

	// Compute local-time equivalent of the NEXT occurrence so DST is correct
	// for the date shown.
	const sundayStart = upcomingSundayStart(now);
	const mondayEnd = sundayStart + DAY_MS + MARGIN_MINUTES * 60 * 1000;
	const localStart = formatWeekdayTime(new Date(sundayStart), tz);
	const localEnd = formatWeekdayTime(new Date(mondayEnd), tz);
	return `${SCHEDULE_UTC} (${localStart} → ${localEnd})`;
}

// Sunday 00:00 UTC >= now-7d; if `now` is Sunday UTC, returns today's start.
function upcomingSundayStart(now: number): number {
	const day = new Date(now).getUTCDay(); // 0=Sun
	const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
	return day === 0 ? dayStart : dayStart + (7 - day) * DAY_MS;
}

// "22-04-2026 11:00 UTC" (when rendering in UTC) or
// "22-04-2026 11:00 UTC (22-04-2026 13:00 UTC+2)" (when a local tz is given).
function formatMoment(d: Date, tz: string): string {
	const utc = `${formatDdMmYyyy(d, "UTC")} UTC`;
	if (tz === "UTC") return utc;
	const local = `${formatDdMmYyyy(d, tz)} ${utcOffsetLabel(d, tz)}`;
	return `${utc} (${local})`;
}

// "Sunday 02:00 UTC+2" — weekday + wall-clock time + offset in the given tz.
function formatWeekdayTime(d: Date, tz: string): string {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: tz,
		weekday: "long",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(d);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
	return `${get("weekday")} ${get("hour")}:${get("minute")} ${utcOffsetLabel(d, tz)}`;
}

function formatDdMmYyyy(d: Date, tz: string): string {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(d);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
	return `${get("day")}-${get("month")}-${get("year")} ${get("hour")}:${get("minute")}`;
}

// "UTC+2" / "UTC-4" / "UTC+5:30" / "UTC+0".
function utcOffsetLabel(d: Date, tz: string): string {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: tz,
		timeZoneName: "shortOffset",
	}).formatToParts(d);
	const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
	// `shortOffset` produces "GMT", "GMT+2", "GMT-5", "GMT+5:30", "GMT+0", etc.
	if (name === "GMT" || name === "UTC") return "UTC+0";
	return name.replace(/^GMT/, "UTC");
}

// ---------------- network readers ----------------

async function fetchVaultLock(
	rpcUrl: string,
	vaultAddress: string,
): Promise<boolean> {
	const res = await fetch(rpcUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "eth_call",
			params: [{ to: vaultAddress, data: LOCK_SELECTOR }, "latest"],
		}),
	});
	if (!res.ok) throw new Error(`Arbitrum RPC HTTP ${res.status}`);
	const json = (await res.json()) as {
		result?: string;
		error?: { message: string };
	};
	if (json.error) throw new Error(`Arbitrum RPC error: ${json.error.message}`);
	if (!json.result) throw new Error("Arbitrum RPC: empty result");
	// `bool` encodes as 32-byte word with 0 or 1 in the last byte.
	return BigInt(json.result) === 1n;
}

type HlLedgerEntry = {
	time: number;
	hash?: string;
	delta?: {
		type?: string;
		vault?: string;
		usdc?: string;
		isDeposit?: boolean;
	};
};

async function fetchLastLeaderVaultDeposit(
	apiUrl: string,
	leaderAddress: string,
	hlVaultId: string,
	now: number,
): Promise<number | null> {
	const res = await fetch(apiUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			type: "userNonFundingLedgerUpdates",
			user: leaderAddress,
			startTime: now - HL_LOOKBACK_MS,
		}),
	});
	if (!res.ok) throw new Error(`Hyperliquid info HTTP ${res.status}`);
	const entries = (await res.json()) as HlLedgerEntry[];
	if (!Array.isArray(entries))
		throw new Error("Hyperliquid info: unexpected response shape");
	const v = hlVaultId.toLowerCase();
	const deposits = entries.filter(
		(e) =>
			e?.delta?.type === "vaultDeposit" &&
			typeof e.delta.vault === "string" &&
			e.delta.vault.toLowerCase() === v,
	);
	if (deposits.length === 0) return null;
	return Math.max(...deposits.map((e) => Number(e.time)));
}
