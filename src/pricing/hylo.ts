import { Connection } from "@solana/web3.js";
import { reportError } from "../utils/errorContext";
import { MARKETS_URL } from "../utils/markets";

const XSOL_MINT = "4sWNB8zGWHkh6UnmwiEtzNxL4XrN7uK9tosbESbJFfVs";
export const JITOSOL_MINT = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const RATIO_SCALE = 10n ** 18n;

async function getXsolRate(): Promise<number> {
    const response = await fetch(`${MARKETS_URL}/prices`);
    if (!response.ok) {
        throw new Error(`Failed to fetch Loopscale prices: ${response.status} ${response.statusText}`);
    }
    const prices: Record<string, { spotPrice?: number }> = await response.json();
    const xsolPrice = prices[XSOL_MINT]?.spotPrice;
    const jitoSolPrice = prices[JITOSOL_MINT]?.spotPrice;
    if (typeof xsolPrice !== "number" || !Number.isFinite(xsolPrice) || xsolPrice <= 0 ||
        typeof jitoSolPrice !== "number" || !Number.isFinite(jitoSolPrice) || jitoSolPrice <= 0) {
        throw new Error("Missing or invalid xSOL/JitoSOL prices");
    }
    return xsolPrice / jitoSolPrice;
}

function getDecimals(decimalMap: Map<string, number>): [number, number] {
    const xsol = decimalMap.get(XSOL_MINT);
    const jitosol = decimalMap.get(JITOSOL_MINT);
    if (xsol == null || jitosol == null || !Number.isInteger(xsol) || !Number.isInteger(jitosol) || xsol < 0 || jitosol < 0) {
        throw new Error("Missing or invalid xSOL/JitoSOL decimals");
    }
    return [xsol, jitosol];
}

export async function getXsolBalanceInJitoSol(_connection: Connection, balances: {[mint: string]: number}, decimalMap: Map<string, number>) {
    const mint = XSOL_MINT;
    const balance = balances[mint];
    if (balance === undefined || balance === 0) return balances;
    try {
        const [xsolDecimals, jitoSolDecimals] = getDecimals(decimalMap);
        const rate = await getXsolRate();
        const amount = balance * rate * 10 ** (jitoSolDecimals - xsolDecimals);
        if (!Number.isFinite(amount)) throw new Error("Invalid xSOL conversion amount");
        balances[JITOSOL_MINT] = (balances[JITOSOL_MINT] || 0) + amount;
        delete balances[mint];
    } catch (error) {
        console.error("Error in xsol balance fetch:", error);
    }
    return balances;
}

export async function getXsolBalanceInJitoSolBn(_connection: Connection, balances: {[mint: string]: bigint}, decimalMap: Map<string, number>) {
    const mint = XSOL_MINT;
    const balance = balances[mint];
    if (balance === undefined || balance === 0n) return balances;
    try {
        const [xsolDecimals, jitoSolDecimals] = getDecimals(decimalMap);
        const rate = await getXsolRate();
        const scaledRate = BigInt(Math.round(rate * Number(RATIO_SCALE)));
        const amount = balance * scaledRate * (10n ** BigInt(jitoSolDecimals))
            / (RATIO_SCALE * (10n ** BigInt(xsolDecimals)));
        balances[JITOSOL_MINT] = (balances[JITOSOL_MINT] || 0n) + amount;
        delete balances[mint];
    } catch (error) {
        console.error("Error in xsol balance fetch:", error);
        reportError("hylo", error);
    }
    return balances;
}
