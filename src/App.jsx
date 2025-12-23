import { useEffect, useState, useRef } from "react";
import { ethers } from "ethers";
import logo from "./assets/swaparc-logo.png";
import "./App.css";
import { getPrices } from "./priceFetcher";

const ARC_CHAIN_ID_DEC = 5042002;
const ARC_CHAIN_ID_HEX = "0x4CEF52";
const DEFAULT_TOKENS = [
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x3600000000000000000000000000000000000000",
  },
  {
    symbol: "EURC",
    name: "Euro Coin",
    address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  },
];

function Ticker({ tokens, prices }) {
  const [items, setItems] = useState(() =>
    tokens.map((t) => ({
      ...t,
      price:
        prices && prices[t.symbol] != null
          ? Number(prices[t.symbol])
          : formatPriceMock(t.symbol),
    }))
  );

  useEffect(() => {
    setItems(
      tokens.map((t) => ({
        ...t,
        price:
          prices && prices[t.symbol] != null
            ? Number(prices[t.symbol])
            : formatPriceMock(t.symbol),
      }))
    );
  }, [tokens, prices]);

  useEffect(() => {
    const iv = setInterval(() => {
      setItems((prev) =>
        prev.map((it) => {
          if (prices && prices[it.symbol] != null) return it;
          const drift = (Math.random() * 0.3 - 0.15) / 100;
          const newPrice = Number(Number(it.price) * (1 + drift)).toFixed(4);
          return { ...it, price: newPrice };
        })
      );
    }, 6000);
    return () => clearInterval(iv);
  }, [prices]);

  const double = [...items, ...items];

  return (
    <div className="ticker-viewport" aria-hidden="true">
      <div className="ticker-track">
        {double.map((t, i) => (
          <div className="ticker-item" key={`${t.symbol}-${i}`}>
            <div className="ticker-logo">{t.symbol.slice(0, 1)}</div>
            <div className="ticker-name">{t.symbol}</div>
            <div className="ticker-price">
              {prices && prices[t.symbol] != null
                ? `$${Number(prices[t.symbol]).toLocaleString(undefined, {
                    maximumFractionDigits: 6,
                  })}`
                : `$${t.price}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatPriceMock(sym) {
  const base =
    {
      USDC: 1,
      EURC: 1.07,
      USDG: 1,
      ARCX: 0.42,
      wETH: 3475.12,
      wBTC: 94000,
      SOL: 180.4,
      BTC: 94000,
      ETH: 3475.12,
    }[sym] ?? 1;
  return Number(base).toFixed(base >= 100 ? 0 : base >= 10 ? 2 : 4);
}

function TokenSelect({ tokens, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef();

  useEffect(() => {
    function docClick(e) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("click", docClick);
    return () => document.removeEventListener("click", docClick);
  }, []);

  const options = tokens.filter((t) =>
    (t.symbol + " " + t.name).toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="tokenselect" ref={ref}>
      <button className="tokenbtn" onClick={() => setOpen((o) => !o)}>
        <span className="tokenBadgeSmall">{value.slice(0, 3)}</span>
        <span className="tokenLabel">{value}</span>
        <span className="caret">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="tokendropdown">
          <input
            className="tokensearch"
            placeholder="Search token..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <ul className="tokenoptions">
            {options.map((t) => (
              <li key={t.address}>
                <button
                  className="tokenOptionBtn"
                  onClick={() => {
                    onChange(t.symbol);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <span className="tokenBadgeSmall">
                    {t.symbol.slice(0, 3)}
                  </span>
                  <div style={{ textAlign: "left" }}>
                    <div className="optSym">{t.symbol}</div>
                    <div className="optName">{t.name}</div>
                  </div>
                </button>
              </li>
            ))}
            {options.length === 0 && <li className="nooptions">No tokens</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function App() {
  function openFaucet() {
    window.open("https://faucet.circle.com/", "_blank");
  }
  const [address, setAddress] = useState(null);
  const [network, setNetwork] = useState(null);
  const [status, setStatus] = useState("Not connected");
  const [balances, setBalances] = useState({});
  const [tokens, setTokens] = useState(DEFAULT_TOKENS);
  const [swapFrom, setSwapFrom] = useState("USDC");
  const [swapTo, setSwapTo] = useState("EURC");
  const [swapAmount, setSwapAmount] = useState("");
  const [quote, setQuote] = useState(null); // textual quote when user triggers swap or fallback
  const [arrowSpin, setArrowSpin] = useState(false);
  const [customAddr, setCustomAddr] = useState("");
  const [estimatedTo, setEstimatedTo] = useState(""); // auto-calculated target amount shown in UI

  const [prices, setPrices] = useState({}); // { SYMBOL: number | null }

  const POOL_ADDRESS = "0x5A30dE47f430dc820204Ce3E3419f013bfC6565F";
  const POOL_ABI = [
    "function swap(address tokenIn, uint256 amountIn)",
    "function getReserves() view returns (uint256 reserveA, uint256 reserveB)",
  ];
  // ERC20 ABI used throughout (balanceOf, decimals, symbol; plus allowance/approve)
  const ERC20_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
  ];

  // fetch prices on mount and every 10s
  useEffect(() => {
    let mounted = true;
    async function fetchAndSet() {
      const syms = tokens.map((t) => t.symbol);
      try {
        const result = await getPrices(syms);
        if (!mounted) return;
        setPrices((prev) => ({ ...prev, ...result }));
      } catch (e) {
        console.warn("price refresh failed", e);
      }
    }

    fetchAndSet();
    const iv = setInterval(fetchAndSet, 10000);
    return () => {
      mounted = false;
      clearInterval(iv);
    };
  }, [tokens]);

  // Recompute estimation whenever swapAmount / tokens / selection changes
  useEffect(() => {
    computeEstimateAuto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapAmount, swapFrom, swapTo, prices]);

  function computeEstimateAuto() {
    if (!swapAmount || Number(swapAmount) <= 0) {
      setEstimatedTo("");
      return;
    }

    const amt = Number(swapAmount);
    const pFrom = prices[swapFrom];
    const pTo = prices[swapTo];

    if (pFrom != null && pTo != null && Number(pFrom) > 0) {
      const spread = 0.003; // 0.3%
      const rate = (Number(pTo) / Number(pFrom)) * (1 - spread);
      const received = amt * rate;

      setEstimatedTo(
        received.toLocaleString(undefined, { maximumFractionDigits: 6 })
      );
      return;
    }

    if (
      (swapFrom === "USDC" && swapTo === "EURC") ||
      (swapFrom === "EURC" && swapTo === "USDC")
    ) {
      // simple FX assumption
      const FX = swapFrom === "USDC" ? 0.93 : 1.075;
      const received = amt * FX;

      setEstimatedTo(
        received.toLocaleString(undefined, { maximumFractionDigits: 6 })
      );
      return;
    }

    // ❌ Nothing else available
    setEstimatedTo("—");
  }

  // New: estimate using pool.callStatic.swap when possible, to show real on-chain approximation
  useEffect(() => {
    // estimateOut updates estimatedTo with the on-chain estimate (preferred)
    let mounted = true;
    async function estimateOut() {
      if (!swapAmount || Number(swapAmount) <= 0) {
        return;
      }
      // Need provider (read-only)
      try {
        if (!window.ethereum) {
          return; // no wallet; keep previous estimate
        }
        const provider = new ethers.BrowserProvider(window.ethereum);
        const tokenFrom = tokens.find((t) => t.symbol === swapFrom);
        const tokenTo = tokens.find((t) => t.symbol === swapTo);
        if (!tokenFrom || !tokenTo) return;

        const tokenIn = new ethers.Contract(
          tokenFrom.address,
          ERC20_ABI,
          provider
        );
        const tokenOut = new ethers.Contract(
          tokenTo.address,
          ERC20_ABI,
          provider
        );
        const decimalsIn = await tokenIn.decimals().catch(() => 18);
        const decimalsOut = await tokenOut.decimals().catch(() => 18);

        const amountIn = ethers.parseUnits(String(swapAmount), decimalsIn);

        const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, provider);

        // callStatic.swap -> estimate expected out without sending tx
        let expectedOut = null;
        try {
          expectedOut = await pool.callStatic.swap(tokenFrom.address, amountIn);
        } catch (e) {
          // callStatic might fail for some custom pool implementations
          expectedOut = null;
        }

        if (!mounted) return;

        if (expectedOut != null) {
          const human = Number(ethers.formatUnits(expectedOut, decimalsOut));
          // format and place in the same field used by UI
          const formatted =
            human >= 1000
              ? human.toLocaleString(undefined, { maximumFractionDigits: 2 })
              : human.toLocaleString(undefined, { maximumFractionDigits: 6 });
          setEstimatedTo(formatted);
        }
      } catch (e) {
        // ignore; we already have price-based estimate as fallback
        // console.warn("estimateOut failed:", e);
      }
    }

    estimateOut();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapAmount, swapFrom, swapTo, tokens]);

  function setPercentAmount(percent) {
    const bal = balances[swapFrom];
    if (!bal || bal === "n/a") return;

    const amount =
      percent === 100 ? Number(bal) : Number(bal) * (percent / 100);

    setSwapAmount(amount.toFixed(2));
  }

  async function ensureArcNetwork() {
    const { ethereum } = window;
    if (!ethereum) return false;

    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ARC_CHAIN_ID_HEX }],
      });
      return true;
    } catch (err) {
      if (err.code === 4902) {
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: ARC_CHAIN_ID_HEX,
              chainName: "Arc Testnet",
              nativeCurrency: {
                name: "ARC",
                symbol: "ARC",
                decimals: 18,
              },
              rpcUrls: ["https://rpc.testnet.arc.network"],
              blockExplorerUrls: ["https://testnet.arcscan.app"],
            },
          ],
        });

        return true;
      }
      return false;
    }
  }
  async function connectWallet() {
    try {
      const { ethereum } = window;
      if (!ethereum) {
        setStatus("No wallet found. Please install MetaMask or Rabby.");
        return;
      }

      // 1️⃣ Ensure Arc network FIRST
      const ok = await ensureArcNetwork();
      if (!ok) {
        setStatus("Please switch to Arc Testnet");
        return;
      }

      // 2️⃣ Request accounts
      const accounts = await ethereum.request({
        method: "eth_requestAccounts",
      });

      if (!accounts?.length) {
        setStatus("No account found.");
        return;
      }

      const userAddress = accounts[0];

      // 3️⃣ Confirm network
      const provider = new ethers.BrowserProvider(ethereum);
      const net = await provider.getNetwork();

      if (Number(net.chainId) !== ARC_CHAIN_ID_DEC) {
        setStatus("Failed to switch to Arc Testnet");
        return;
      }

      // 4️⃣ Update app state
      setAddress(userAddress);
      setNetwork(Number(net.chainId));
      setStatus("Connected to Arc Testnet");

      // 5️⃣ Load balances
      await fetchBalances(userAddress, provider);
    } catch (err) {
      console.error("connectWallet error:", err);
      setStatus("Wallet connection failed");
    }
  }

  async function disconnectWallet() {
    setAddress(null);
    setNetwork(null);
    setStatus("Not connected");
    setBalances({});
    setQuote(null);
    setSwapAmount("");
    setEstimatedTo("");
  }

  async function fetchBalances(userAddress, provider) {
    try {
      const tokenBalances = {};
      // note: your code previously used provider.getBalance(userAddress) as USDC
      // keep same behavior to avoid changing UI logic
      const rawUSDC = await provider.getBalance(userAddress);
      tokenBalances["USDC"] = parseFloat(ethers.formatEther(rawUSDC)).toFixed(
        4
      );

      for (const t of tokens) {
        try {
          const tokenContract = new ethers.Contract(
            t.address,
            ERC20_ABI,
            provider
          );
          const rawBalance = await tokenContract.balanceOf(userAddress);
          const decimals = await tokenContract.decimals();
          tokenBalances[t.symbol] = parseFloat(
            ethers.formatUnits(rawBalance, decimals)
          ).toFixed(4);
        } catch {
          tokenBalances[t.symbol] = "n/a";
        }
      }

      setBalances(tokenBalances);
    } catch (err) {
      console.error("Failed to fetch balances:", err);
    }
  }

  function shortAddr(a) {
    if (!a) return "";
    return a.slice(0, 6) + "..." + a.slice(-4);
  }

  function onSwapArrowClick() {
    setArrowSpin(true);
    setTimeout(() => setArrowSpin(false), 600);
    const prev = swapFrom;
    setSwapFrom(swapTo);
    setSwapTo(prev);
    setQuote(null);
    setEstimatedTo("");
  }

  async function requestQuoteFallback() {
    // legacy fallback if prices not available
    setQuote("Loading quote...");
    setTimeout(() => {
      const rate = (Math.random() * (1.05 - 0.95) + 0.95).toFixed(4);
      const received = (Number(swapAmount) * Number(rate)).toFixed(4);
      setQuote(
        `${swapAmount} ${swapFrom} → ~ ${received} ${swapTo} (rate ${rate})`
      );
    }, 700);
  }

  async function performSwap() {
    // Single button behaviour:
    if (!swapAmount || Number(swapAmount) <= 0) {
      alert("Enter a valid amount to swap.");
      return;
    }
    if (
      !balances[swapFrom] ||
      balances[swapFrom] === "n/a" ||
      Number(swapAmount) > Number(balances[swapFrom])
    ) {
      alert("Insufficient or unknown balance for " + swapFrom);
      return;
    }
    if (swapFrom === swapTo) {
      alert("Choose different tokens to swap.");
      return;
    }

    if (
      !["USDC", "EURC"].includes(swapFrom) ||
      !["USDC", "EURC"].includes(swapTo)
    ) {
      alert("This pool only supports USDC ↔ EURC swaps.");
      return;
    }

    try {
      if (!window.ethereum) {
        alert("Wallet not available in browser.");
        return;
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const tokenFrom = tokens.find((t) => t.symbol === swapFrom);
      const tokenTo = tokens.find((t) => t.symbol === swapTo);

      if (!tokenFrom || !tokenTo) {
        alert("Token not found");
        return;
      }

      const tokenInAddress = tokenFrom.address;
      const tokenOutAddress = tokenTo.address;

      const tokenIn = new ethers.Contract(tokenInAddress, ERC20_ABI, signer);
      const tokenOut = new ethers.Contract(
        tokenOutAddress,
        ERC20_ABI,
        provider
      );

      const decimalsIn = await tokenIn.decimals().catch(() => 18);
      const decimalsOut = await tokenOut.decimals().catch(() => 18);

      const amountIn = ethers.parseUnits(String(swapAmount), decimalsIn);

      // step 1: approve pool if required
      const allowance = await tokenIn.allowance(
        await signer.getAddress(),
        POOL_ADDRESS
      );
      if (BigInt(allowance) < BigInt(amountIn)) {
        setQuote("Approving token...");
        const txA = await tokenIn.approve(POOL_ADDRESS, amountIn);
        setQuote("Waiting approval confirmation...");
        await txA.wait();
      }

      // step 2: estimate output using callStatic (read-only)
      const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, signer);

      let expectedOut = null;
      try {
        expectedOut = await pool.callStatic.swap(tokenInAddress, amountIn);
      } catch (e) {
        // callStatic may fail for some pools; we continue without estimate
        expectedOut = null;
      }

      let expectedOutHuman = null;
      if (expectedOut != null) {
        expectedOutHuman = Number(ethers.formatUnits(expectedOut, decimalsOut));
      }

      if (expectedOutHuman != null) {
        setQuote(
          `Estimated receive: ~ ${expectedOutHuman.toFixed(
            decimalsOut >= 6 ? 6 : 4
          )} ${swapTo}. Sending swap...`
        );
      } else {
        setQuote("Sending swap (no on-chain estimate) — check wallet...");
      }

      // step 3: perform pool swap (on-chain)
      const tx = await pool.swap(tokenInAddress, amountIn);
      setQuote(`Swap submitted: tx ${tx.hash} — waiting for confirmation...`);
      await tx.wait();

      if (expectedOutHuman != null) {
        setQuote(
          `Swap succeeded: ~ ${expectedOutHuman.toFixed(
            decimalsOut >= 6 ? 6 : 4
          )} ${swapTo} — tx ${tx.hash}`
        );
      } else {
        setQuote(`Swap succeeded — tx ${tx.hash}`);
      }

      // refresh balances
      await fetchBalances(await signer.getAddress(), provider);
    } catch (err) {
      console.error(err);
      const m = err && err.message ? err.message : String(err);
      setQuote("Swap failed: " + m);
      alert("Swap failed: " + m);
    }
  }

  function addCustomToken() {
    const addr = (customAddr || "").trim();
    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      alert("Enter a valid Ethereum-style address (0x...).");
      return;
    }
    const symbol = "TKN" + addr.slice(-3).toUpperCase();
    const exists = tokens.some(
      (t) => t.address.toLowerCase() === addr.toLowerCase()
    );
    if (exists) {
      alert("Token already in list.");
      return;
    }
    const newToken = { symbol, name: symbol + " (custom)", address: addr };
    setTokens((prev) => [newToken, ...prev]);
    setCustomAddr("");
    alert(`Added ${symbol} — it appears at top of token list.`);
  }

  function tokenIcon(symbol) {
    return <span className="token-badge">{symbol.slice(0, 3)}</span>;
  }

  function usdValueFor(symbol) {
    const bal = balances[symbol];
    const p = prices[symbol];
    if (!bal || bal === "n/a" || p == null) return null;
    const numericBal = Number(bal);
    if (Number.isNaN(numericBal)) return null;
    return numericBal * Number(p);
  }

  return (
    <div className="app-page hybrid-page">
      <div className="app-container hybrid-center">
        {/* HEADER */}
        <header className="headerRow hybrid-header">
          <div
            className="brand"
            style={{ cursor: "pointer" }}
            onClick={() => window.location.reload()}
          >
            <img src={logo} alt="SwapARC" className="logoImg big" />
            <div>
              <div className="title">SWAPARC</div>
              <div className="subtitle">Stablecoin FX & Treasury tools</div>
            </div>
          </div>
          <div className="headerRight">
            <button
              className="faucetBtn"
              onClick={openFaucet}
              style={{
                marginRight: "12px",
                padding: "8px 14px",
                borderRadius: "10px",
                background: "rgba(0, 200, 255, 0.15)",
                border: "1px solid rgba(0, 200, 255, 0.35)",
                color: "#9fe8ff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              💧 Get Faucet
            </button>

            {!address ? (
              <button className="connectBtn" onClick={connectWallet}>
                Connect Wallet
              </button>
            ) : (
              <>
                <div className="walletCard small">
                  <div className="walletNetwork">Arc Testnet </div>
                  <div className="walletAddress">{shortAddr(address)}</div>
                </div>

                <button className="disconnectBtn" onClick={disconnectWallet}>
                  Disconnect
                </button>
              </>
            )}
          </div>
        </header>

        {/* TICKER */}
        <Ticker tokens={tokens} prices={prices} />

        {/* MAIN */}
        <main className="main">
          <section className="topCards hybrid-grid">
            {/* BALANCES */}
            <div className="card balancesBox neon-card">
              <h3>Token Balances</h3>

              {Object.keys(balances).length === 0 ? (
                <p className="muted">
                  No balances loaded — connect wallet & click Connect.
                </p>
              ) : (
                <ul className="balancesList">
                  {tokens
                    .filter((t) => {
                      const bal = balances[t.symbol];
                      return bal && bal !== "n/a" && Number(bal) > 0;
                    })
                    .map((t) => (
                      <li className="balanceItem" key={t.address}>
                        <div className="balanceLeft">
                          {tokenIcon(t.symbol)}
                          <div className="balanceSymbol">{t.symbol}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div className="balanceRight">
                            {balances[t.symbol] ?? "—"}
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.8 }}>
                            {usdValueFor(t.symbol) != null
                              ? `$${usdValueFor(t.symbol).toLocaleString(
                                  undefined,
                                  { maximumFractionDigits: 2 }
                                )}`
                              : prices[t.symbol] == null
                              ? "price n/a"
                              : ""}
                          </div>
                        </div>
                      </li>
                    ))}
                </ul>
              )}

              <div style={{ marginTop: 12 }}>
                <input
                  placeholder="Paste token address (0x...)"
                  value={customAddr}
                  onChange={(e) => setCustomAddr(e.target.value)}
                  style={{
                    width: "100%",
                    padding: 8,
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.06)",
                    marginBottom: 8,
                    background: "transparent",
                    color: "#eaf6ff",
                  }}
                />
                <button onClick={addCustomToken} className="smallAddBtn">
                  Add Token
                </button>
              </div>
            </div>

            {/* SWAP CARD */}
            <div className="card controls neon-card swapCardCentered">
              <h2>SWAP</h2>

              <div className="swapRowClean">
                <div className="swapLabel">From</div>
                <div className="swapBox">
                  <TokenSelect
                    tokens={tokens}
                    value={swapFrom}
                    onChange={setSwapFrom}
                  />
                  <input
                    className="swapInput"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={swapAmount}
                    onChange={(e) => setSwapAmount(e.target.value)}
                  />
                </div>
                <div className="percentRow">
                  {[25, 50, 75].map((p) => (
                    <button
                      key={p}
                      className="percentBtn"
                      onClick={() => setPercentAmount(p)}
                    >
                      {p}%
                    </button>
                  ))}
                  <button
                    className="percentBtn"
                    onClick={() => setPercentAmount(100)}
                  >
                    Max
                  </button>
                </div>
              </div>

              <div className="swapCenter">
                <button
                  className={`swapArrow ${arrowSpin ? "spin" : ""}`}
                  onClick={onSwapArrowClick}
                >
                  ⇅
                </button>
              </div>

              <div className="swapRowClean">
                <div className="swapLabel">To (estimated)</div>
                <div className="swapBox">
                  <TokenSelect
                    tokens={tokens}
                    value={swapTo}
                    onChange={setSwapTo}
                  />
                  <div className="swapInput readOnly">
                    {estimatedTo || (quote ? "…" : "—")}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <button className="primaryBtn neon-btn" onClick={performSwap}>
                  Swap
                </button>
              </div>

              {quote && (
                <p className="quote">
                  <strong>Quote:</strong> {quote}
                </p>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
