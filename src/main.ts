import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { getDecimalMap } from './utils';
import { errorContext } from './utils/errorContext';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  getMeteoraTokenBalances,
  getExponentTokenBalances,
  UNDERLYING_EXPONENT_MINT_DATA,
  deriveStakePoolExchangeRates,
  getRateXTokenBalances,
  parseAndConvertWhirlpoolPositions,
  UNDERLYING_RATEX_MINT_DATA,
  JITOSOL_MINT,
  parseAndConvertWhirlpoolPositionsBn,
  getExponentTokenBalancesBn,
  getRateXTokenBalancesBn,
  deriveStakePoolExchangeRatesBn,
  getMeteoraTokenBalancesBn,
  getXsolBalanceInJitoSol,
  getXsolBalanceInJitoSolBn,
  getRatioConvertedBalances,
  getRatioConvertedBalancesBn,
  RATIO_UNDERLYING_MINTS,
  getDawnDealBalances,
  getDawnDealBalancesBn
} from './pricing';

const app = express();
const HTTP_PORT = process.env.HTTP_PORT || 80;

// Enable CORS for all routes
app.use(cors());

// Parse JSON bodies
app.use(express.json());

app.get('/', async (_req: Request, res: Response) => {
  return res.send('ack');
});

const handler = {
    "whirlpools": parseAndConvertWhirlpoolPositions,
    // before hylo so PT-xSOL converted here joins direct xSOL in the JitoSOL conversion
    "ratio": getRatioConvertedBalances,
    "dawn": getDawnDealBalances,
    "exponent": getExponentTokenBalances,
    "ratex": getRateXTokenBalances,
    "hylo": getXsolBalanceInJitoSol,
    "sanctum": deriveStakePoolExchangeRates,
    "meteora": getMeteoraTokenBalances,
};

app.post(
  "/decompile_mints",
  async (req: Request, res: Response) => {
    try {
      let balances = req.body.rawBalances;

      const mints = Object.keys(balances).map((mint) => new PublicKey(mint));
      mints.push(...Object.values(UNDERLYING_EXPONENT_MINT_DATA).map((mint) => new PublicKey(mint)));
      mints.push(...Object.values(UNDERLYING_RATEX_MINT_DATA).map((mint) => new PublicKey(mint)));
      mints.push(...[new PublicKey(JITOSOL_MINT)]) // Adding in case not present for Hylo XSol
      mints.push(...RATIO_UNDERLYING_MINTS.map((mint) => new PublicKey(mint)));

      const url = process.env.SOLANA_RPC_URL;
      if (!url) {
        return res.status(500).json({ error: "SOLANA_RPC_URL environment variable is not set." });
      }
      const connection = new Connection(url, "confirmed");

      const decimalMap = await getDecimalMap(connection, mints);

      const handlers = Object.keys(handler) as (keyof typeof handler)[];

      for (const handlerName of handlers) {
        balances = await handler[handlerName](connection, balances, decimalMap);
      }

      res.json(balances);
    } catch (error) {
      console.error("Error processing request:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  },
);

const handlerBn = {
    "whirlpools": parseAndConvertWhirlpoolPositionsBn,
    // before hylo so PT-xSOL converted here joins direct xSOL in the JitoSOL conversion
    "ratio": getRatioConvertedBalancesBn,
    "dawn": getDawnDealBalancesBn,
    "exponent": getExponentTokenBalancesBn,
    "ratex": getRateXTokenBalancesBn,
    "hylo": getXsolBalanceInJitoSolBn,
    "sanctum": deriveStakePoolExchangeRatesBn,
    "meteora": getMeteoraTokenBalancesBn,
};

type BigIntStringMap = Record<string, string>;
type BigIntMap = Record<string, bigint>;

export function parseBigIntStringMap(input: BigIntStringMap): BigIntMap {
  const out: BigIntMap = Object.create(null);

  for (const [k, v] of Object.entries(input)) {
    if (typeof v !== "string") {
      throw new Error(`Value for key "${k}" must be a string`);
    }

    const s = v.trim();
    // Optional: basic validation (decimal, optional leading -)
    if (!/^-?\d+$/.test(s)) {
      throw new Error(`Invalid bigint string for key "${k}": "${v}"`);
    }

    out[k] = BigInt(s);
  }

  return out;
}

export function stringifyBigIntMap(input: BigIntMap): BigIntStringMap {
  const out: BigIntStringMap = Object.create(null);

  for (const [k, v] of Object.entries(input)) {
    if (typeof v !== "bigint") {
      throw new Error(`Value for key "${k}" must be a bigint`);
    }
    out[k] = v.toString(10);
  }

  return out;
}

app.post(
  "/v1/decompile_mints",
  async (req: Request, res: Response) => {
    try {
      let balances = parseBigIntStringMap(req.body.rawBalances);

      const mints = Object.keys(balances).map((mint) => new PublicKey(mint));
      mints.push(...Object.values(UNDERLYING_EXPONENT_MINT_DATA).map((mint) => new PublicKey(mint)));
      mints.push(...Object.values(UNDERLYING_RATEX_MINT_DATA).map((mint) => new PublicKey(mint)));
      mints.push(...[new PublicKey(JITOSOL_MINT)]) // Adding in case not present for Hylo XSol
      mints.push(...RATIO_UNDERLYING_MINTS.map((mint) => new PublicKey(mint)));

      const url = process.env.SOLANA_RPC_URL;
      if (!url) {
        return res.status(500).json({ error: "SOLANA_RPC_URL environment variable is not set." });
      }
      const connection = new Connection(url, "confirmed");

      const decimalMap = await getDecimalMap(connection, mints);

      const handlers = Object.keys(handlerBn) as (keyof typeof handlerBn)[];

      const requestErrors: string[] = [];
      await errorContext.run(requestErrors, async () => {
        for (const handlerName of handlers) {
          balances = await handlerBn[handlerName](connection, balances, decimalMap);
        }
      });

      if (requestErrors.length > 0) {
        // Fail loud: any handler reporting an error makes this a bad response.
        // Returning 500 lets clients (e.g. DefiLlama) fall back to their last-good snapshot
        // instead of persisting a silently-partial number.
        throw new Error(`pricing pipeline had ${requestErrors.length} failure(s): ${requestErrors.join('; ')}`);
      }

      const strBalances = stringifyBigIntMap(balances);

      res.json(strBalances);
    } catch (error) {
      console.error("Error processing request:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  },
);

app.listen(HTTP_PORT, () => {
  console.log(`Server is running at http://localhost:${HTTP_PORT}`);
});