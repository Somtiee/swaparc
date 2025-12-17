// src/priceFetcher.js
// Simple wrapper to fetch USD prices from CoinGecko for our token list.
// Returns an object: { SYMBOL: priceInUSD (number) | null }

const SYMBOL_TO_COINGECKO_ID = {
    // tokens in your DEFAULT_TOKENS
    USDC: "usd-coin",
    EURC: "eurc",             // CoinGecko has 'eurc'
    USDG: "global-dollar",    // CoinGecko 'global-dollar' (USDG)
    // ARCX likely custom/not listed -> leave unmapped so fetcher returns null
    ARCX: null,
    wETH: "weth",             // wrapped ether
    wBTC: "wrapped-bitcoin",  // wrapped bitcoin
    SOL: "solana",
    BTC: "bitcoin",
    ETH: "ethereum"
  };
  
  /**
   * Fetch prices from CoinGecko for the symbols (array of SYMBOL strings).
   * Returns: Promise resolving to { SYMBOL: number | null }
   */
  export async function getPrices(symbols = []) {
    // build unique list of coingecko ids to request
    const ids = [];
    const mapping = {}; // id -> [symbols...]
    for (const s of symbols) {
      const id = SYMBOL_TO_COINGECKO_ID[s];
      if (!id) continue;
      if (!ids.includes(id)) ids.push(id);
      mapping[id] = mapping[id] || [];
      mapping[id].push(s);
    }
  
    // prepare result with null defaults
    const result = {};
    for (const s of symbols) result[s] = null;
  
    if (ids.length === 0) {
      return result;
    }
  
    try {
      const qs = `ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd`;
      const url = `https://api.coingecko.com/api/v3/simple/price?${qs}`;
  
      const resp = await fetch(url, { method: "GET" });
      if (!resp.ok) {
        // non-fatal: return nulls
        console.warn("priceFetcher: coingecko fetch failed", resp.status);
        return result;
      }
  
      const data = await resp.json(); // e.g. { bitcoin: { usd: 54000 }, ethereum: { usd: 3200 }, ... }
  
      // map back to symbols
      for (const id of Object.keys(data)) {
        const priceObj = data[id];
        if (!priceObj || typeof priceObj.usd !== "number") continue;
        const symbolsForId = mapping[id] || [];
        for (const sym of symbolsForId) result[sym] = priceObj.usd;
      }
    } catch (e) {
      console.warn("priceFetcher error", e);
      // return nulls on error
    }
  
    return result;
  }
  