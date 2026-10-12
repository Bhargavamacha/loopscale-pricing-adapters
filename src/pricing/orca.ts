import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import WhirlpoolIdl from '../contracts/whirlpool.json';
import { getProgramAddress, whirlpoolTokenBalancesBn } from "../utils";
import { reportError } from "../utils/errorContext";

const whirlpoolProgram = (connection: Connection) => {
    const provider = new AnchorProvider(
        connection,
        { publicKey: PublicKey.default, signTransaction: (tx) => Promise.resolve(tx), signAllTransactions: (txs) => Promise.resolve(txs) },
        AnchorProvider.defaultOptions()
    );
    const program = new Program(WhirlpoolIdl, provider);
    return program;
};

const BATCH_SIZE = 10;

async function getMultipleAccountsBatched(connection: Connection, keys: PublicKey[]) {
    const accounts = [];
    for (let i = 0; i < keys.length; i = i + BATCH_SIZE) {
        const batch = keys.slice(i, Math.min(i + BATCH_SIZE, keys.length));
        accounts.push(...(await connection.getMultipleAccountsInfo(batch)));
    }
    return accounts;
}

// Fetches and decodes only the position PDAs for the given mints, then only the whirlpools those
// positions reference. Never scan the whole Whirlpool program (getProgramAccounts) here: that is
// ~160k accounts per request and lets any caller amplify RPC load.
async function fetchPositionsAndWhirlpools(program: any, connection: Connection, positionMints: string[]) {
    const positionPdas = positionMints.map((mint) => {
        const seeds = [Buffer.from("position"), new PublicKey(mint).toBytes()];
        return getProgramAddress(seeds, program.programId);
    });

    const positionAccounts = await getMultipleAccountsBatched(connection, positionPdas);
    const parsedPositions = positionAccounts
        .filter((account) => account !== null && account.data !== undefined)
        .map((account) => program.coder.accounts.decode('position', account!.data));

    const whirlpoolKeys = [...new Set(parsedPositions.map((pp: any) => pp.whirlpool.toString()))].map((key) => new PublicKey(key));
    const whirlpoolAccounts = await getMultipleAccountsBatched(connection, whirlpoolKeys);
    const whirlpools = new Map<string, any>();
    whirlpoolAccounts.forEach((account, idx) => {
        if (account !== null && account.data !== undefined) {
            whirlpools.set(whirlpoolKeys[idx].toString(), program.coder.accounts.decode('whirlpool', account.data));
        }
    });

    return { parsedPositions, whirlpools };
}

function getWhirlpoolTokenAmountsBn(whirlpool: any, position: any, tokenADecimals: number, tokenBDecimals: number) {
    const positionLiquidityAmount = position.liquidity;
    const currentSqrtPrice = whirlpool.sqrtPrice;

    const lowerTickIndex = position.tickLowerIndex;
    const upperTickIndex = position.tickUpperIndex;
    const tokenAmounts = whirlpoolTokenBalancesBn(positionLiquidityAmount, currentSqrtPrice, tokenADecimals, tokenBDecimals, lowerTickIndex, upperTickIndex)

    return tokenAmounts;
}

async function attemptParseWhirlpoolPositionsBn(connection: Connection, positionMints: string[], decimalMap: Map<string, number>) {
    const program = whirlpoolProgram(connection) as any;
    const tokenBalances: {[position: string]: {[mint: string]: bigint} | undefined } = {};
    positionMints.forEach((mint) => { tokenBalances[mint] = undefined; });
    const { parsedPositions, whirlpools } = await fetchPositionsAndWhirlpools(program, connection, positionMints);

    // For each position PDA
    for (let i = 0; i < parsedPositions.length; i++) {
        const parsedPosition = parsedPositions[i];
        // Get Whirlpool for position
        const whirlpool = whirlpools.get(parsedPosition.whirlpool.toString());
        if (!whirlpool) {
            console.warn(`Missing whirlpool account: ${parsedPosition.whirlpool.toString()}`);
            continue;
        }
        const tokenAMint = whirlpool.tokenMintA.toString();
        const decimalA = decimalMap.get(tokenAMint);
        const tokenBMint = whirlpool.tokenMintB.toString();
        const decimalB = decimalMap.get(tokenBMint);

        // Get token amounts for position (Helper)
        // TODO error handling for missing decimals
        if (!decimalA || !decimalB) {
            console.warn(`Missing decimals for token mints: ${tokenAMint} or ${tokenBMint}`);
            continue;
        }
        // Get token amounts for position
        const tokenAmounts = getWhirlpoolTokenAmountsBn(whirlpool, parsedPosition, decimalA, decimalB);

        // Add to base token map
        tokenBalances[parsedPosition.positionMint.toString()] = {
            [tokenAMint]: tokenAmounts.depositA,
            [tokenBMint]: tokenAmounts.depositB
        };
    }
    // Return map
    return tokenBalances;
}

export async function parseAndConvertWhirlpoolPositionsBn(connection: Connection, balances: {[mint: string]: bigint}, decimalMap: Map<string, number>) {
    try {
        // Determine which mints are whirlpool positions by filtering fro amount == 1, then attempting to fetch their Whirlpool PDA
        const potentialWhirlpoolPositions = Object.keys(balances).filter((mint) => balances[mint] == BigInt(1));
        if (potentialWhirlpoolPositions.length === 0) {
            return balances;
        }
        const wpBalances = await attemptParseWhirlpoolPositionsBn(connection, potentialWhirlpoolPositions, decimalMap);
        for (const mint of Object.keys(wpBalances)) {
            const wpBalance = wpBalances[mint];
            if (wpBalance !== undefined) {
                // Is a whirlpool position, add to balances
                const mintsInPosition = Object.keys(wpBalance);
                for (const mintInPosition of mintsInPosition) {
                    const amount = wpBalance[mintInPosition];
                    if (amount !== undefined) {
                        // Add to balances
                        balances[mintInPosition] = (balances[mintInPosition] || 0n) + amount;
                    }
                }
                // Remove whirlpool position mint from balances
                delete balances[mint];
            }
        }
    } catch (error) {
        console.error("Error parsing whirlpool positions:", error);
        reportError("whirlpools", error);
    }
    return balances;
}