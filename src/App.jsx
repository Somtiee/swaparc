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
    index: 0,
  },
  {
    symbol: "EURC",
    name: "Euro Coin",
    address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    index: 1,
  },
  {
    symbol: "SWPRC",
    name: "SwapARC Coin",
    address: "0xBE7477BF91526FC9988C8f33e91B6db687119D45",
    index: 2,
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
      EURC: 1.063,
      SWPRC: 0.71,
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
  const [activeTab, setActiveTab] = useState("swap");
  const [swapHistory, setSwapHistory] = useState(() => {
    try {
      const saved = localStorage.getItem("swaparc_history");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [txModal, setTxModal] = useState(null);
  const [swapTo, setSwapTo] = useState("EURC");
  const [swapAmount, setSwapAmount] = useState("");
  const [quote, setQuote] = useState(null); // textual quote when user triggers swap or fallback
  const [arrowSpin, setArrowSpin] = useState(false);
  const [customAddr, setCustomAddr] = useState("");
  const [estimatedTo, setEstimatedTo] = useState(""); // auto-calculated target amount shown in UI

  const [prices, setPrices] = useState({}); // { SYMBOL: number | null }
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
      const FX = swapFrom === "USDC" ? 0.93 : 1.075;
      const received = amt * FX;
  
      setEstimatedTo(
        received.toLocaleString(undefined, { maximumFractionDigits: 6 })
      );
      return;
    }
  
    setEstimatedTo("—");
  }
  useEffect(() => {
    computeEstimateAuto();
  }, [swapAmount, swapFrom, swapTo, prices]);  

  const POOL_ADDRESS = "0x2F4490e7c6F3DaC23ffEe6e71bFcb5d1CCd7d4eC";
  const POOL_ABI = [
    "function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) payable",
    "function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)",
  ];
  
  // ERC20 ABI used throughout (balanceOf, decimals, symbol; plus allowance/approve)
  const ERC20_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
  ];

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
  
  useEffect(() => {
    try {
      localStorage.setItem("swaparc_history", JSON.stringify(swapHistory));
    } catch (e) {
      console.warn("Failed to persist history", e);
    }
  }, [swapHistory]);
  // New: estimate using pool.callStatic.swap when possible, to show real on-chain approximation
  useEffect(() => {
    let mounted = true;
  
    async function estimateOut() {
      if (!swapAmount || Number(swapAmount) <= 0) return;
  
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, provider);
  
        const fromToken = tokens.find(t => t.symbol === swapFrom);
        const toToken = tokens.find(t => t.symbol === swapTo);
        if (!fromToken || !toToken) return;
  
        let decimalsIn;
        if (fromToken.symbol === "USDC") {
          decimalsIn = 18;
        } else {
          const tokenIn = new ethers.Contract(fromToken.address, ERC20_ABI, provider);
          decimalsIn = await tokenIn.decimals();
        }
        
        const dx = ethers.parseUnits(swapAmount, decimalsIn);        
  
        const dy = await pool.get_dy(
          fromToken.index,
          toToken.index,
          dx
        );
  
        if (!mounted) return;
        let decimalsOut;
        if (toToken.symbol === "USDC") {
          decimalsOut = 18;
        } else {
          const tokenOut = new ethers.Contract(toToken.address, ERC20_ABI, provider);
          decimalsOut = await tokenOut.decimals();
        }
        
        const outHuman = Number(
          ethers.formatUnits(dy, 18)
        );        
        setEstimatedTo(outHuman.toLocaleString(undefined, {
          maximumFractionDigits: 6,
        }));
      } catch {
        // fallback keeps UI alive
      }
    }
  
    estimateOut();
    return () => (mounted = false);
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
      if (tokenFrom.symbol !== "USDC") {
        const tokenDecimals = await tokenIn.decimals();
        const approveAmount = ethers.parseUnits(
          String(swapAmount),
          tokenDecimals
        );
      
        const allowance = await tokenIn.allowance(
          await signer.getAddress(),
          POOL_ADDRESS
        );
      
        if (BigInt(allowance) < BigInt(approveAmount)) {
          const txA = await tokenIn.approve(POOL_ADDRESS, approveAmount);
          await txA.wait();
        }
      }      
      
      
// 🔥 POOL INPUT MUST ALWAYS BE 18 DECIMALS
const amountIn = ethers.parseUnits(
  String(swapAmount),
  18
);

const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, signer);

// optional on-chain estimate (safe)
let expectedOutHuman = null;
try {
  const dy = await pool.get_dy(
    tokenFrom.index,
    tokenTo.index,
    amountIn
  );
  expectedOutHuman = Number(
    ethers.formatUnits(dy, 18)
  );  
} catch {
  // ignore estimation failure
}

setQuote("Sending swap — confirm in wallet...");
let tx;

if (tokenFrom.symbol === "USDC") {
  tx = await pool.exchange(
    tokenFrom.index,
    tokenTo.index,
    amountIn,
    0,
    { value: amountIn }
  );  
} else {
  tx = await pool.exchange(
    tokenFrom.index,
    tokenTo.index,
    amountIn,
    0 // no slippage protection for now
  );  
}

await tx.wait();

      setQuote(`Swap submitted: tx ${tx.hash} — waiting for confirmation...`);
      const txUrl = `https://testnet.arcscan.app/tx/${tx.hash}`;

      setSwapHistory((prev) => [
        {
          fromToken: swapFrom,
          fromAmount: swapAmount,
          toToken: swapTo,
          toAmount:
            expectedOutHuman != null
              ? expectedOutHuman.toFixed(6)
              : estimatedTo || "0.000000",
          txUrl,
          status: "success",
        },
        ...prev,
      ]);

      setTxModal({
        status: "success",
        fromToken: swapFrom,
        fromAmount: swapAmount,
        toToken: swapTo,
        toAmount:
          expectedOutHuman != null
            ? expectedOutHuman.toFixed(6)
            : estimatedTo || "0.000000",
        txHash: tx.hash,
      });

      if (expectedOutHuman != null) {
        setQuote(
          `Swap succeeded: ~ ${expectedOutHuman.toFixed(6)} ${swapTo} — tx ${tx.hash}`
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
      setTxModal({
        status: "failed",
        fromToken: swapFrom,
        fromAmount: swapAmount,
        toToken: swapTo,
        toAmount: "—",
        txHash: null,
      });
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
            <div className="card controls neon-card swapCardCentered">
              <div className="tabHeader">
                <button
                  className={`tabBtn ${activeTab === "swap" ? "active" : ""}`}
                  onClick={() => setActiveTab("swap")}
                >
                  Swap
                </button>
                <button
                  className={`tabBtn ${
                    activeTab === "history" ? "active" : ""
                  }`}
                  onClick={() => setActiveTab("history")}
                >
                  History
                </button>
              </div>
              {activeTab === "swap" && (
                <>
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
                    <div className="percentRow relay-style">
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
                    <button
                      className="primaryBtn neon-btn"
                      onClick={performSwap}
                    >
                      Swap
                    </button>
                  </div>

                  {quote && (
                    <p className="quote">
                      <strong>Quote:</strong> {quote}
                    </p>
                  )}
                </>
              )}
              {activeTab === "history" && (
                <div className="historyBox">
                  {swapHistory.length === 0 ? (
                    <p className="muted">No swaps yet.</p>
                  ) : (
                    <ul className="historyList">
                      {swapHistory.map((tx, i) => (
                        <li key={i} className="historyItem">
                          <div>
                            <strong>From:</strong> {tx.fromAmount}{" "}
                            {tx.fromToken}
                          </div>
                          <div>
                            <strong>To:</strong> {tx.toAmount} {tx.toToken}
                          </div>
                          <div className="historyMeta">
                            <a href={tx.txUrl} target="_blank" rel="noreferrer">
                              View Tx
                            </a>
                            <span className={`status ${tx.status}`}>
                              {tx.status.toUpperCase()}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
      {txModal && (
        <div className="modalOverlay">
          <div className="txModal">
            {/* 🎉 CONFETTI – only shows on success */}
            {txModal.status === "success" && (
              <div className="confetti">
                {Array.from({ length: 24 }).map((_, i) => (
                  <span key={i} />
                ))}
              </div>
            )}

            <h3>
              {txModal.status === "success"
                ? "Transaction Completed"
                : "Swap Failed"}
            </h3>

            <div className="txRow">
              <span>Sent</span>
              <strong>
                {txModal.fromAmount} {txModal.fromToken}
              </strong>
            </div>

            <div className="txRow">
              <span>Received</span>
              <strong>
                {txModal.toAmount} {txModal.toToken}
              </strong>
            </div>

            <div className="txActions">
              {txModal.txHash && (
                <a
                  href={`https://testnet.arcscan.app/tx/${txModal.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="secondaryBtn"
                >
                  View details
                </a>
              )}
              <button className="primaryBtn" onClick={() => setTxModal(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
