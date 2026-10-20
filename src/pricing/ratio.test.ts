import assert from "node:assert/strict";
import { test } from "node:test";
import { Connection } from "@solana/web3.js";
import { getRatioConvertedBalances, getRatioConvertedBalancesBn } from "./ratio";
import { errorContext } from "../utils/errorContext";

const USD_INFRA = "dawn7ZUF7h7anFuEsDdAU1Y3HYwikwqNMAENZsQJdNL";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const connection = new Connection("http://localhost:8899");
const decimals = new Map([[USD_INFRA, 6], [USDC, 6]]);

test("USD.infra uses the oracle ratio and merges with existing USDC", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string) => ({
    ok: true,
    json: async () => ({ usdPrice: url.endsWith(USD_INFRA) ? 0.98 : 1 }),
  }));
  const balances = { [USD_INFRA]: 3_000_000n, [USDC]: 1_000_000n, other: 7n };
  assert.deepEqual(
    await getRatioConvertedBalancesBn(connection, balances, decimals),
    { [USDC]: 3_940_000n, other: 7n }
  );
});

test("legacy number balances use both oracle prices", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string) => ({
    ok: true,
    json: async () => ({ usdPrice: url.endsWith(USD_INFRA) ? 1 : 0.8 }),
  }));
  assert.deepEqual(
    await getRatioConvertedBalances(connection, { [USD_INFRA]: 2_000_000 }, decimals),
    { [USDC]: 2_500_000 }
  );
});

test("unavailable USD.infra pricing reports failure and preserves the balance", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 503 }));
  t.mock.method(console, "error", () => {});
  const errors: string[] = [];
  const balances = { [USD_INFRA]: 3_000_000n };
  await errorContext.run(errors, () =>
    getRatioConvertedBalancesBn(connection, balances, decimals)
  );
  assert.deepEqual(balances, { [USD_INFRA]: 3_000_000n });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ratio/);
});
