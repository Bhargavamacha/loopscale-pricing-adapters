import { Connection } from "@solana/web3.js";
import { reportError } from "../utils/errorContext";
import { MARKETS_URL } from "../utils/markets";

// DAWN private-credit deals post a supply-1, 0-decimal NFT as loan collateral.
// Each NFT's value is simply its deal's outstanding principal, which the
// markets service publishes on the public /deals route (`principalBaseUnits`,
// in USDC base units) — no oracle needed. Matching by nftMint against the
// request balances also means new deals are picked up automatically.

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

interface Deal {
  nftMint?: string | null;
  principalBaseUnits?: string | null;
}

const DEALS_FETCH_ATTEMPTS = 3;

async function fetchDealPrincipals(): Promise<Map<string, bigint>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < DEALS_FETCH_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
    try {
      const res = await fetch(`${MARKETS_URL}/deals`);
      if (!res.ok) {
        throw new Error(`deals fetch returned ${res.status}`);
      }
      const body = (await res.json()) as { deals?: Deal[] };
      if (!Array.isArray(body.deals)) {
        throw new Error("deals response missing deals array");
      }
      const principals = new Map<string, bigint>();
      for (const deal of body.deals) {
        if (deal.nftMint && deal.principalBaseUnits) {
          principals.set(deal.nftMint, BigInt(deal.principalBaseUnits));
        }
      }
      return principals;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function getDawnDealBalancesBn(
  _connection: Connection,
  balances: { [mint: string]: bigint },
  _decimalMap: Map<string, number>
) {
  try {
    const principals = await fetchDealPrincipals();

    for (const [mint, balance] of Object.entries(balances)) {
      const principal = principals.get(mint);
      if (principal === undefined) continue;

      // balance is an NFT count (0 decimals, in practice 1); principal is
      // already in USDC base units, so no decimal switch is needed.
      balances[USDC_MINT] = (balances[USDC_MINT] || 0n) + balance * principal;
      delete balances[mint];
    }
  } catch (error) {
    console.error("Error in getDawnDealBalancesBn:", error);
    // Fail the request rather than silently dropping deal collateral: without
    // the deals list we cannot even tell which mints are DAWN NFTs.
    reportError("dawn", error);
  }

  return balances;
}

export async function getDawnDealBalances(
  _connection: Connection,
  balances: { [mint: string]: number },
  _decimalMap: Map<string, number>
) {
  try {
    const principals = await fetchDealPrincipals();

    for (const [mint, balance] of Object.entries(balances)) {
      const principal = principals.get(mint);
      if (principal === undefined) continue;

      balances[USDC_MINT] = (balances[USDC_MINT] || 0) + balance * Number(principal);
      delete balances[mint];
    }
  } catch (error) {
    console.error("Error in getDawnDealBalances:", error);
    // Gracefully fail and keep the original balances, matching the legacy handlers
  }

  return balances;
}
