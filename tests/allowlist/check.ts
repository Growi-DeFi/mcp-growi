// Pure-logic smoke test for the L1 + L2 transaction allowlist in
// src/tools/write.ts. Exercises the four legitimate (contract, selector)
// pairs as positive cases, plus a representative set of negative cases
// covering both layers of the gate.
//
// Run: npx tsx tests/allowlist/check.ts
//
// Exits 0 if every case behaved as expected, 1 otherwise. Network-free —
// validates the regression target of v0.2.0 without needing an RPC or
// keystore.

import { encodeFunctionData, type Address, type Hex } from "viem";
import { checkAllowlist, decodeAndValidate } from "../../src/tools/write.ts";
import {
	GROWI_HF_VAULT_ADDRESS,
	GWHF_TOKEN_ADDRESS,
	USDC_TOKEN_ADDRESS,
	GROWI_HF_VAULT_ABI,
	ERC20_ABI,
} from "../../src/contract/index.ts";

const ATTACKER: Address = "0x000000000000000000000000000000000000dEaD";
const RANDOM_CONTRACT: Address = "0x1111111111111111111111111111111111111111";

type Case = {
	name: string;
	to: Address;
	data: Hex;
	expect: "pass" | { reject: "L1" | "L2"; matches: RegExp };
};

const cases: Case[] = [
	// --- Positive cases: must pass both gates ---
	{
		name: "USDC.approve(vault, 100e6)",
		to: USDC_TOKEN_ADDRESS,
		data: encodeFunctionData({
			abi: ERC20_ABI,
			functionName: "approve",
			args: [GROWI_HF_VAULT_ADDRESS, 100_000_000n],
		}),
		expect: "pass",
	},
	{
		name: "vault.deposit(100e6)",
		to: GROWI_HF_VAULT_ADDRESS,
		data: encodeFunctionData({
			abi: GROWI_HF_VAULT_ABI,
			functionName: "deposit",
			args: [100_000_000n],
		}),
		expect: "pass",
	},
	{
		name: "GWHF.approve(vault, 1e18)",
		to: GWHF_TOKEN_ADDRESS,
		data: encodeFunctionData({
			abi: ERC20_ABI,
			functionName: "approve",
			args: [GROWI_HF_VAULT_ADDRESS, 1_000_000_000_000_000_000n],
		}),
		expect: "pass",
	},
	{
		name: "vault.withdraw(1e18)",
		to: GROWI_HF_VAULT_ADDRESS,
		data: encodeFunctionData({
			abi: GROWI_HF_VAULT_ABI,
			functionName: "withdraw",
			args: [1_000_000_000_000_000_000n],
		}),
		expect: "pass",
	},

	// --- L1 negatives: (to, selector) pair not allowlisted ---
	{
		// Raw hex: transfer(address,uint256) selector + 32 zero bytes (address) +
		// 32 zero bytes (amount). Calldata bytes are attacker-controlled at the
		// execute_transaction boundary — they don't have to round-trip through
		// any ABI shipped by the project.
		name: "USDC.transfer(attacker, amt) [L1: realistic drain attack]",
		to: USDC_TOKEN_ADDRESS,
		data: `0xa9059cbb${"0".repeat(128)}` as Hex,
		expect: { reject: "L1", matches: /not on the Growi allowlist/ },
	},
	{
		// Nonsense selector against an allowlisted contract — proves the L1 gate
		// is a strict allowlist, not a denylist of known-dangerous selectors.
		// `0xdeadbeef` is not a real Solidity 4-byte function ID for anything.
		name: "USDC.0xdeadbeef(...) [L1: arbitrary unknown selector]",
		to: USDC_TOKEN_ADDRESS,
		data: `0xdeadbeef${"0".repeat(128)}` as Hex,
		expect: { reject: "L1", matches: /not on the Growi allowlist/ },
	},
	{
		name: "vault.0xcafebabe(...) [L1: arbitrary unknown selector on vault]",
		to: GROWI_HF_VAULT_ADDRESS,
		data: `0xcafebabe${"0".repeat(128)}` as Hex,
		expect: { reject: "L1", matches: /not on the Growi allowlist/ },
	},
	{
		name: "random.approve(vault, amt) [L1: bad contract]",
		to: RANDOM_CONTRACT,
		data: encodeFunctionData({
			abi: ERC20_ABI,
			functionName: "approve",
			args: [GROWI_HF_VAULT_ADDRESS, 1_000_000n],
		}),
		expect: { reject: "L1", matches: /not on the Growi allowlist/ },
	},
	{
		name: "vault.approve(vault, amt) [L1: vault doesn't approve]",
		to: GROWI_HF_VAULT_ADDRESS,
		data: encodeFunctionData({
			abi: ERC20_ABI,
			functionName: "approve",
			args: [GROWI_HF_VAULT_ADDRESS, 1_000_000n],
		}),
		expect: { reject: "L1", matches: /not on the Growi allowlist/ },
	},

	// --- L2 negatives: (to, selector) on allowlist but args bad ---
	{
		name: "USDC.approve(attacker, amt) [L2: wrong spender]",
		to: USDC_TOKEN_ADDRESS,
		data: encodeFunctionData({
			abi: ERC20_ABI,
			functionName: "approve",
			args: [ATTACKER, 1_000_000n],
		}),
		expect: { reject: "L2", matches: /spender is .* expected/ },
	},
	{
		name: "vault.deposit(0) [L2: zero amount]",
		to: GROWI_HF_VAULT_ADDRESS,
		data: encodeFunctionData({
			abi: GROWI_HF_VAULT_ABI,
			functionName: "deposit",
			args: [0n],
		}),
		expect: { reject: "L2", matches: /amount must be greater than 0/ },
	},
	{
		name: "vault.withdraw(0) [L2: zero amount]",
		to: GROWI_HF_VAULT_ADDRESS,
		data: encodeFunctionData({
			abi: GROWI_HF_VAULT_ABI,
			functionName: "withdraw",
			args: [0n],
		}),
		expect: { reject: "L2", matches: /amount must be greater than 0/ },
	},
];

function runCase(c: Case): { ok: boolean; detail: string } {
	// L1 check first — matches production flow in execute_transaction.
	try {
		checkAllowlist(c.to, c.data);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (c.expect === "pass") {
			return { ok: false, detail: `expected pass, got L1 reject: ${msg}` };
		}
		if (c.expect.reject !== "L1") {
			return {
				ok: false,
				detail: `expected ${c.expect.reject} reject, got L1: ${msg}`,
			};
		}
		if (!c.expect.matches.test(msg)) {
			return {
				ok: false,
				detail: `L1 message did not match ${c.expect.matches}: ${msg}`,
			};
		}
		return { ok: true, detail: `L1 reject: ${msg.slice(0, 80)}…` };
	}

	// L1 passed — now L2.
	try {
		decodeAndValidate(c.data);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (c.expect === "pass") {
			return { ok: false, detail: `expected pass, got L2 reject: ${msg}` };
		}
		if (c.expect.reject !== "L2") {
			return {
				ok: false,
				detail: `expected ${c.expect.reject} reject, got L2: ${msg}`,
			};
		}
		if (!c.expect.matches.test(msg)) {
			return {
				ok: false,
				detail: `L2 message did not match ${c.expect.matches}: ${msg}`,
			};
		}
		return { ok: true, detail: `L2 reject: ${msg.slice(0, 80)}…` };
	}

	// Both passed.
	if (c.expect !== "pass") {
		return {
			ok: false,
			detail: `expected ${c.expect.reject} reject, but both gates passed`,
		};
	}
	return { ok: true, detail: "both gates passed" };
}

let failures = 0;
for (const c of cases) {
	const r = runCase(c);
	const mark = r.ok ? "✓" : "✗";
	console.log(`${mark} ${c.name}`);
	console.log(`  ${r.detail}`);
	if (!r.ok) failures++;
}

console.log("");
console.log(`${cases.length - failures}/${cases.length} cases passed`);
process.exit(failures === 0 ? 0 : 1);
