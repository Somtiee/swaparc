// api/prices/get.js
// Proxies pricing requests to CoinGecko to avoid CORS and 429 issues on the frontend.

const SYMBOL_TO_COINGECKO_ID = {
  USDC: "usd-coin",
  EURC: "eurc",
  USDG: "global-dollar",
  wETH: "weth",
  wBTC: "wrapped-bitcoin",
  SOL: "solana",
  BTC: "bitcoin",
  ETH: "ethereum",
};

export default async function handler(req, res) {
  // Simple GET request
  // Query param 'symbols' is a comma-separated list of symbols
  const { symbols } = req.query;
  if (!symbols) {
    return res.status(400).json({ error: "Missing symbols parameter" });
  }

  const symbolList = symbols.split(",");
  const ids = [];
  const mapping = {};

  for (const s of symbolList) {
    const id = SYMBOL_TO_COINGECKO_ID[s.toUpperCase()];
    if (id) {
      if (!ids.includes(id)) ids.push(id);
      mapping[id] = mapping[id] || [];
      mapping[id].push(s.toUpperCase());
    }
  }

  if (ids.length === 0) {
    return res.status(200).json({});
  }

  try {
    const qs = `ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd`;
    const url = `https://api.coingecko.com/api/v3/simple/price?${qs}`;

    // Add a simple cache or timeout if needed, but for now simple proxy
    const resp = await fetch(url, { 
        method: "GET",
        headers: {
            "Accept": "application/json",
            "User-Agent": "Swaparc-Backend/1.0"
        }
    });

    if (!resp.ok) {
      console.error("[PriceProxy] CoinGecko error:", resp.status);
      return res.status(502).json({ error: "CoinGecko unreachable" });
    }

    const data = await resp.json();
    const result = {};

    // Map back to our symbols
    for (const id of Object.keys(data)) {
      const priceObj = data[id];
      if (priceObj && typeof priceObj.usd === "number") {
        const ourSymbols = mapping[id] || [];
        for (const sym of ourSymbols) {
          result[sym] = priceObj.usd;
        }
      }
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("[PriceProxy] Proxy failure:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
