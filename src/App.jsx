import { useEffect, useState, useRef } from "react";
import { ethers } from "ethers";
import logo from "./assets/swaparc-logo.png";
import "./App.css";
import { getPrices } from "./priceFetcher";

const ARC_CHAIN_ID_DEC = 5042002;
const ARC_CHAIN_ID_HEX = "0x4CEF52";

const POOL_ADDRESS = "0x2F4490e7c6F3DaC23ffEe6e71bFcb5d1CCd7d4eC";

const POOL_ABI = [
  "function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)",
  "function swap(uint256 i, uint256 j, uint256 dx) returns (uint256)",
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const INITIAL_TOKENS = [
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
  {
    symbol: "SWPRC",
    name: "SwapARC Token",
    address: "0xBE7477BF91526FC9988C8f33e91B6db687119D45",
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
  const tokenIndices = {
    USDC: 0,
    EURC: 1,
    SWPRC: 2,
  };
  const [address, setAddress] = useState(null);
  const [network, setNetwork] = useState(null);
  const [status, setStatus] = useState("Not connected");
  const [balances, setBalances] = useState({});
  const [tokens, setTokens] = useState(INITIAL_TOKENS);
  const [swapFrom, setSwapFrom] = useState("USDC");
  const [poolTxs, setPoolTxs] = useState([]);
  const [historyView, setHistoryView] = useState("mine");
  const TXS_PER_PAGE = 10;
  const [txPage, setTxPage] = useState(0);
  const startIdx = txPage * TXS_PER_PAGE;
  const endIdx = startIdx + TXS_PER_PAGE;
  const pagedTxs = poolTxs.slice(startIdx, endIdx);
  const walletTxs = address
    ? poolTxs.filter(
        (tx) =>
          tx.from?.toLowerCase() === address.toLowerCase() ||
          tx.to?.toLowerCase() === address.toLowerCase()
      )
    : [];
  const pagedWalletTxs = walletTxs.slice(startIdx, endIdx);
  const activeHistoryTxs = historyView === "all" ? pagedTxs : pagedWalletTxs;
  const activeHistoryTotal =
    historyView === "all" ? poolTxs.length : walletTxs.length;
  const [txLoading, setTxLoading] = useState(false);
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [swapAmount, setSwapAmount] = useState("");
  const [quote, setQuote] = useState(null);
  const [arrowSpin, setArrowSpin] = useState(false);
  const [customAddr, setCustomAddr] = useState("");
  const [estimatedTo, setEstimatedTo] = useState("");

  const [prices, setPrices] = useState({});

  async function fetchPoolTransactions() {
    setTxLoading(true);
    try {
      const res = await fetch(
        `https://testnet.arcscan.app/api?module=account&action=txlist&address=${POOL_ADDRESS}&sort=desc`
      );
      const data = await res.json();

      if (data.status !== "1") {
        setPoolTxs([]);
        return;
      }

      setPoolTxs(data.result);
    } catch (err) {
      console.error("Failed to fetch pool txs", err);
    } finally {
      setTxLoading(false);
    }
  }
  useEffect(() => {
    setTxPage(0);
  }, [historyView]);

  useEffect(() => {
    if (activeTab === "history") {
      setTxPage(0);
      fetchPoolTransactions();
    }
  }, [activeTab]);
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
    let mounted = true;
    async function estimateOut() {
      if (
        !swapAmount ||
        Number(swapAmount) <= 0 ||
        swapFrom === swapTo ||
        Object.keys(tokenIndices).length === 0
      ) {
        setEstimatedTo("");
        return;
      }

      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const fromToken = tokens.find((t) => t.symbol === swapFrom);
        const toToken = tokens.find((t) => t.symbol === swapTo);
        if (!fromToken || !toToken) return;

        const i = tokenIndices[swapFrom];
        const j = tokenIndices[swapTo];

        const tokenIn = new ethers.Contract(
          fromToken.address,
          ERC20_ABI,
          provider
        );
        const decimalsIn = await tokenIn.decimals();
        const amountIn = ethers.parseUnits(swapAmount, decimalsIn);

        const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, provider);
        const dy = await pool.get_dy(i, j, amountIn);

        const decimalsOut = await new ethers.Contract(
          toToken.address,
          ERC20_ABI,
          provider
        )
          .decimals()
          .catch(() => 6);
        const human = Number(ethers.formatUnits(dy, decimalsOut));

        const formatted =
          human >= 1000
            ? human.toLocaleString(undefined, { maximumFractionDigits: 2 })
            : human.toLocaleString(undefined, { maximumFractionDigits: 6 });

        if (mounted) setEstimatedTo(formatted);
      } catch (e) {
        console.warn("On-chain estimate failed", e);
        setEstimatedTo("—");
      }
    }

    estimateOut();
    return () => {
      mounted = false;
    };
  }, [swapAmount, swapFrom, swapTo, tokens, tokenIndices]);

  useEffect(() => {
    try {
      localStorage.setItem("swaparc_history", JSON.stringify(swapHistory));
    } catch (e) {
      console.warn("Failed to persist history", e);
    }
  }, [swapHistory]);

  function setPercentAmount(percent) {
    const bal = balances[swapFrom];
    if (!bal || bal === "n/a") return;

    const amount =
      percent === 100 ? Number(bal) : Number(bal) * (percent / 100);

    setSwapAmount(amount.toFixed(6));
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

      const ok = await ensureArcNetwork();
      if (!ok) {
        setStatus("Please switch to Arc Testnet");
        return;
      }

      const accounts = await ethereum.request({
        method: "eth_requestAccounts",
      });

      if (!accounts?.length) {
        setStatus("No account found.");
        return;
      }

      const userAddress = accounts[0];

      const provider = new ethers.BrowserProvider(ethereum);
      const net = await provider.getNetwork();

      if (Number(net.chainId) !== ARC_CHAIN_ID_DEC) {
        setStatus("Failed to switch to Arc Testnet");
        return;
      }

      setAddress(userAddress);
      setNetwork(Number(net.chainId));
      setStatus("Connected to Arc Testnet");

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
  function isMyTx(tx) {
    if (!address) return false;

    return (
      tx.from?.toLowerCase() === address.toLowerCase() ||
      tx.to?.toLowerCase() === address.toLowerCase()
    );
  }

  function formatDateTime(ts) {
    if (!ts) return "—";
    const d = new Date(Number(ts) * 1000);
    return d.toLocaleString();
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

  async function performSwap() {
    if (!swapAmount || Number(swapAmount) <= 0) {
      alert("Enter a valid amount to swap.");
      return;
    }
    if (swapFrom === swapTo) {
      alert("Choose different tokens to swap.");
      return;
    }
    if (Object.keys(tokenIndices).length === 0) {
      alert("Pool not loaded – please reconnect wallet.");
      return;
    }
    if (
      !balances[swapFrom] ||
      balances[swapFrom] === "n/a" ||
      Number(swapAmount) > Number(balances[swapFrom])
    ) {
      alert("Insufficient balance for " + swapFrom);
      return;
    }

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const fromToken = tokens.find((t) => t.symbol === swapFrom);
      const toToken = tokens.find((t) => t.symbol === swapTo);
      if (!fromToken || !toToken) throw new Error("Token not found");

      const i = tokenIndices[swapFrom];
      const j = tokenIndices[swapTo];

      const tokenIn = new ethers.Contract(fromToken.address, ERC20_ABI, signer);
      const decimalsIn = await tokenIn.decimals();
      const amountIn = ethers.parseUnits(swapAmount, decimalsIn);

      const allowance = await tokenIn.allowance(
        await signer.getAddress(),
        POOL_ADDRESS
      );
      if (BigInt(allowance) < BigInt(amountIn)) {
        setQuote("Approving token...");
        const txA = await tokenIn.approve(POOL_ADDRESS, amountIn);
        await txA.wait();
      }

      const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, signer);

      let expectedOut = null;
      try {
        expectedOut = await pool.get_dy(i, j, amountIn);
      } catch {}

      let expectedHuman = null;
      if (expectedOut) {
        const decOut = await new ethers.Contract(
          toToken.address,
          ERC20_ABI,
          provider
        )
          .decimals()
          .catch(() => 6);
        expectedHuman = Number(ethers.formatUnits(expectedOut, decOut));
      }

      setQuote(
        expectedHuman
          ? `Estimated: ~${expectedHuman.toFixed(6)} ${swapTo}. Sending...`
          : "Sending swap..."
      );

      const min_dy = 0;

      const tx = await pool.swap(i, j, amountIn);
      setQuote(`Submitted: ${tx.hash} – waiting confirmation...`);
      await tx.wait();
      const txUrl = `https://testnet.arcscan.app/tx/${tx.hash}`;

      setSwapHistory((prev) => [
        {
          fromToken: swapFrom,
          fromAmount: swapAmount,
          toToken: swapTo,
          toAmount: expectedHuman
            ? expectedHuman.toFixed(6)
            : estimatedTo || "0",
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
        toAmount: expectedHuman ? expectedHuman.toFixed(6) : estimatedTo || "0",
        txHash: tx.hash,
      });

      setQuote(`Swap succeeded — tx ${tx.hash}`);

      await fetchBalances(await signer.getAddress(), provider);
    } catch (err) {
      console.error(err);
      const m = err?.message || String(err);
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
          <div className="topNav desktopOnly">
            {["swap", "history", "pools"].map((t) => (
              <button
                key={t}
                className={`navBtn ${activeTab === t ? "active" : ""}`}
                onClick={() => setActiveTab(t)}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="headerRight mobileHeader">
  {!address ? (
    <button className="connectBtn" onClick={connectWallet}>
      Connect Wallet
    </button>
  ) : (
    <button
      className="walletPill"
      onClick={disconnectWallet}
    >
      Arc Testnet · {shortAddr(address)}
    </button>
  )}

  <button
    className="hamburgerBtn"
    onClick={() => setMobileMenuOpen(true)}
  >
    ☰
  </button>
</div>

        </header>

        <Ticker tokens={tokens} prices={prices} />

        <main className="main">
          <section className="topCards hybrid-grid">
            <div className="card controls neon-card swapCardCentered">
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
                    {balances[swapFrom] && balances[swapFrom] !== "n/a" && (
                      <div className="tokenBalanceHint">
                        Balance: {balances[swapFrom]}
                      </div>
                    )}

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
                  {balances[swapTo] && balances[swapTo] !== "n/a" && (
                    <div className="tokenBalanceHint">
                      Balance: {balances[swapTo]}
                    </div>
                  )}

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
                  <div className="historyToggleRow">
                    <button
                      className={`historyToggleBtn ${
                        historyView === "mine" ? "active" : ""
                      }`}
                      onClick={() => setHistoryView("mine")}
                    >
                      ONLY MINE
                    </button>

                    <button
                      className={`historyToggleBtn ${
                        historyView === "all" ? "active" : ""
                      }`}
                      onClick={() => setHistoryView("all")}
                    >
                      ALL
                    </button>
                  </div>
                  {txLoading ? (
                    <p className="muted">Loading pool transactions...</p>
                  ) : poolTxs.length === 0 ? (
                    <p className="muted">No transactions found.</p>
                  ) : (
                    <>
                      <ul className="historyList">
                        {activeHistoryTxs.map((tx) => (
                          <li
                            key={tx.hash}
                            className={`historyItem ${
                              historyView === "all" && isMyTx(tx)
                                ? "mineTx"
                                : ""
                            }`}
                          >
                            {/* LEFT SIDE */}
                            <div className="historyLeft">
                              <div>
                                <strong>From:</strong> {shortAddr(tx.from)}
                              </div>
                              <div>
                                <strong>To:</strong> {shortAddr(tx.to)}
                              </div>

                              <div className="historyMeta">
                                <a
                                  href={`https://testnet.arcscan.app/tx/${tx.hash}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  View Tx
                                </a>
                              </div>
                            </div>

                            {/* RIGHT SIDE */}
                            <div className="historyRight">
                              <div className="historyTime">
                                {formatDateTime(tx.timeStamp)}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>

                      <div className="paginationRow">
                        <button
                          className="pageBtn"
                          disabled={txPage === 0}
                          onClick={() => setTxPage((p) => Math.max(0, p - 1))}
                        >
                          ◀ Prev
                        </button>

                        <span className="pageInfo">
                          Page {txPage + 1} /{" "}
                          {Math.ceil(activeHistoryTotal / TXS_PER_PAGE)}
                        </span>

                        <button
                          className="pageBtn"
                          disabled={endIdx >= activeHistoryTotal}
                          onClick={() => setTxPage((p) => p + 1)}
                        >
                          Next ▶
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeTab === "pools" && (
                <div className="comingSoon neon-card">
                  <h2>POOLS</h2>
                  <p>Coming Soon ✨</p>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
      {txModal && (
        <div className="modalOverlay">
          <div className="txModal">
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

     <button onClick={() => { setActiveTab("swap"); setMobileMenuOpen(false); }}>
  Swap
</button>

<button onClick={() => { setActiveTab("history"); setMobileMenuOpen(false); }}>
  History
</button>

<button onClick={() => { setActiveTab("pools"); setMobileMenuOpen(false); }}>
  Pools
</button>

<button onClick={openFaucet}>
  💧 Get Faucet
</button>

<button
  onClick={() => window.open("https://x.com/swaparc_app", "_blank")}
>
  𝕏 Twitter
</button>

<button className="closeBtn" onClick={() => setMobileMenuOpen(false)}>
  Close ✕
</button>

          </div>
        </div>
      )}
    </div>
  );
}
