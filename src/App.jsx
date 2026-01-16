import { useEffect, useState, useRef } from "react";
import { ethers } from "ethers";
import logo from "./assets/swaparc-logo.png";
import usdcLogo from "./assets/usdc.jpg";
import eurcLogo from "./assets/eurc.jpg";
import swprcLogo from "./assets/swprc.jpg";
import "./App.css";
import { getPrices } from "./priceFetcher";

const ARC_CHAIN_ID_DEC = 5042002;
const ARC_CHAIN_ID_HEX = "0x4CEF52";

const SWAP_POOL_ADDRESS = "0x2F4490e7c6F3DaC23ffEe6e71bFcb5d1CCd7d4eC";

const POOLS = [
  {
    id: "usdc-eurc",
    name: "USDC / EURC",
    tokens: ["USDC", "EURC"],
    poolAddress: "0xd22e4fB80E21e8d2C91131eC2D6b0C000491934B",
    lpToken: "0x454f21b7738A446f79ea4ff00e71b9e8E9E6FEE9",
  },
  {
    id: "usdc-swprc",
    name: "USDC / SWPRC",
    tokens: ["USDC", "SWPRC"],
    poolAddress: "0x613bc8A188a571e7Ffe3F884FabAB0F43ABB8282",
    lpToken: "0x2E2C7B48B2422223aD9628DA159f304192c24d3B",
  },
  {
    id: "eurc-swprc",
    name: "EURC / SWPRC",
    tokens: ["EURC", "SWPRC"],
    poolAddress: "0x9463DE67E73B42B2cE5e45cab7e32184B9c24939",
    lpToken: "0xb81816d4fBB3D33b56c3efc04675d1cDed0f68b1",
  },
];

const LP_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
];
const POOL_ABI = [
  "function getBalances() view returns (uint256[])",
  "function lpToken() view returns (address)",
  "function addLiquidity(uint256[] amounts)",
  "function removeLiquidity(uint256 lpAmount)",
  "function claimRewards()",
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
const TOKEN_LOGOS = {
  USDC: usdcLogo,
  EURC: eurcLogo,
  SWPRC: swprcLogo,
};

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
            <div className="ticker-logo">
              <img
                src={TOKEN_LOGOS[t.symbol]}
                alt={t.symbol}
                style={{ width: "100%", height: "100%", borderRadius: "50%" }}
              />
            </div>

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
        <span className="tokenBadgeSmall">
          <img
            src={TOKEN_LOGOS[value]}
            alt={value}
            style={{ width: "100%", height: "100%", borderRadius: "50%" }}
          />
        </span>

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
                    <img
                      src={TOKEN_LOGOS[t.symbol]}
                      alt={t.symbol}
                      style={{
                        width: "100%",
                        height: "100%",
                        borderRadius: "50%",
                      }}
                    />
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
  const [activePreset, setActivePreset] = useState(null);
  const [network, setNetwork] = useState(null);
  const [poolTokenBalances, setPoolTokenBalances] = useState({});
  const [lpTokenAmounts, setLpTokenAmounts] = useState({});
  const [lpBalances, setLpBalances] = useState({});
  const [liquiditySuccess, setLiquiditySuccess] = useState(null);
  const [lpDecimals, setLpDecimals] = useState(18);
  const [poolBalances, setPoolBalances] = useState({});
  const [status, setStatus] = useState("Not connected");
  const [balances, setBalances] = useState({});
  const [tokens, setTokens] = useState(INITIAL_TOKENS);
  const [swapFrom, setSwapFrom] = useState("USDC");
  const [poolTxs, setPoolTxs] = useState([]);
  const [showAddLiquidity, setShowAddLiquidity] = useState(false);
  const [liqInputs, setLiqInputs] = useState({
    USDC: "",
    EURC: "",
    SWPRC: "",
  });
  const [myDeposits, setMyDeposits] = useState({
    USDC: 0,
    EURC: 0,
    SWPRC: 0,
  });

  const [liqLoading, setLiqLoading] = useState(false);
  const [showRemoveLiquidity, setShowRemoveLiquidity] = useState(false);
  const [removeLpAmount, setRemoveLpAmount] = useState("");
  const [removeLoading, setRemoveLoading] = useState(false);
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
  const [poolsView, setPoolsView] = useState("positions");
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

  async function fetchAllLPBalances(user, provider) {
    const balances = {};

    for (const p of POOLS) {
      try {
        const lp = new ethers.Contract(p.lpToken, LP_ABI, provider);
        const raw = await lp.balanceOf(user);
        const dec = await lp.decimals();
        balances[p.id] = Number(raw) / 1e6;
      } catch {
        balances[p.id] = 0;
      }
    }

    setLpBalances(balances);
  }

  async function handleClaimRewards(poolPreset) {
    if (!address) {
      alert("Connect wallet first");
      return;
    }

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const pool = new ethers.Contract(
        poolPreset.poolAddress,
        POOL_ABI,
        signer
      );

      const tx = await pool.claimRewards();
      await tx.wait();

      await fetchBalances(address, provider);
      await fetchAllLPBalances(address, provider);

      alert("Rewards claimed!");
    } catch (err) {
      console.error(err);
      alert("Claim rewards failed");
    }
  }

  async function fetchLPTokenAmounts(user, provider) {
    const result = {};

    for (const p of POOLS) {
      try {
        // Contracts
        const pool = new ethers.Contract(p.poolAddress, POOL_ABI, provider);
        const lp = new ethers.Contract(p.lpToken, LP_ABI, provider);

        // LP math
        const userLP = await lp.balanceOf(user); // raw LP
        const totalLP = await lp.totalSupply(); // raw LP

        if (totalLP === 0n || userLP === 0n) continue;

        const share = Number(userLP) / Number(totalLP);

        // Pool balances
        const balances = await pool.getBalances();

        result[p.id] = {};

        for (let i = 0; i < p.tokens.length; i++) {
          const sym = p.tokens[i];
          const token = INITIAL_TOKENS.find((t) => t.symbol === sym);
          const tokenC = new ethers.Contract(
            token.address,
            ERC20_ABI,
            provider
          );
          const dec = await tokenC.decimals();

          const poolAmount = Number(ethers.formatUnits(balances[i], dec));

          result[p.id][sym] = poolAmount * share;
        }
      } catch (e) {
        console.warn("LP breakdown failed for", p.id, e);
      }
    }

    setLpTokenAmounts(result);
  }

  async function fetchPoolBalances(provider) {
    const tvlResult = {};
    const tokenResult = {};

    for (const p of POOLS) {
      try {
        const pool = new ethers.Contract(p.poolAddress, POOL_ABI, provider);
        const raw = await pool.getBalances();

        tokenResult[p.id] = {};
        let tvl = 0;

        for (let i = 0; i < p.tokens.length; i++) {
          const sym = p.tokens[i];
          const token = INITIAL_TOKENS.find((t) => t.symbol === sym);
          const tokenC = new ethers.Contract(
            token.address,
            ERC20_ABI,
            provider
          );
          const dec = await tokenC.decimals();

          const bal = Number(ethers.formatUnits(raw[i], dec));
          tokenResult[p.id][sym] = bal;

          // Normalize everything to USDC+
          if (sym === "USDC") {
            tvl += bal;
          } else if (sym === "EURC") {
            tvl += bal * (prices.EURC || 1); // EUR → USD
          } else if (sym === "SWPRC") {
            tvl += bal * (prices.SWPRC || 0);
          }
        }

        tvlResult[p.id] = tvl;
      } catch {
        tvlResult[p.id] = 0;
        tokenResult[p.id] = {};
      }
    }

    setPoolBalances(tvlResult);
    setPoolTokenBalances(tokenResult);
  }

  async function fetchPoolTransactions() {
    setTxLoading(true);
    try {
      const res = await fetch(
        `https://testnet.arcscan.app/api?module=account&action=txlist&address=${SWAP_POOL_ADDRESS}&sort=desc`
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
  async function fetchUserPoolTransactions(userAddress) {
    if (!userAddress) return;
  
    setTxLoading(true);
    try {
      const res = await fetch(
        `https://testnet.arcscan.app/api?module=account&action=txlist&address=${userAddress}&sort=desc`
      );
      const data = await res.json();
  
      if (data.status !== "1") {
        setPoolTxs([]);
        return;
      }
  
      const filtered = data.result.filter(
        (tx) =>
          tx.to?.toLowerCase() === SWAP_POOL_ADDRESS.toLowerCase() ||
          tx.from?.toLowerCase() === SWAP_POOL_ADDRESS.toLowerCase()
      );
  
      setPoolTxs(filtered);
    } catch (err) {
      console.error("Failed to fetch user txs", err);
    } finally {
      setTxLoading(false);
    }
  }
  
  useEffect(() => {
    setTxPage(0);
  }, [historyView]);

  useEffect(() => {
    if (activeTab !== "history") return;
  
    setTxPage(0);
  
    if (historyView === "mine" && address) {
      fetchUserPoolTransactions(address);
    } else {
      fetchPoolTransactions();
    }
  }, [activeTab, historyView, address]);
  
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

        const pool = new ethers.Contract(SWAP_POOL_ADDRESS, POOL_ABI, provider);
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
      await fetchAllLPBalances(userAddress, provider);
      await fetchLPTokenAmounts(userAddress, provider);
      await fetchPoolBalances(provider);
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
        SWAP_POOL_ADDRESS
      );

      if (BigInt(allowance) < BigInt(amountIn)) {
        setQuote("Approving token...");
        const txA = await tokenIn.approve(SWAP_POOL_ADDRESS, amountIn);
        await txA.wait();
      }

      const pool = new ethers.Contract(SWAP_POOL_ADDRESS, POOL_ABI, signer);

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

  function totalPoolTVL() {
    return Object.values(poolBalances).reduce(
      (sum, v) => sum + Number(v || 0),
      0
    );
  }

  async function handleAddLiquidity() {
    if (!address) {
      alert("Connect wallet first");
      return;
    }

    try {
      setLiqLoading(true);

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const pool = new ethers.Contract(
        activePreset.poolAddress,
        POOL_ABI,
        signer
      );

      const amounts = [];

      for (const sym of activePreset.tokens) {
        const token = INITIAL_TOKENS.find((t) => t.symbol === sym);
        const rawVal = liqInputs[sym];

        if (!rawVal || Number(rawVal) <= 0) {
          amounts.push(0n);
          continue;
        }

        const tokenContract = new ethers.Contract(
          token.address,
          ERC20_ABI,
          signer
        );

        const decimals = await tokenContract.decimals();
        const parsed = ethers.parseUnits(rawVal, decimals);

        const allowance = await tokenContract.allowance(
          address,
          activePreset.poolAddress
        );

        if (BigInt(allowance) < BigInt(parsed)) {
          const txApprove = await tokenContract.approve(
            activePreset.poolAddress,
            parsed
          );
          await txApprove.wait();
        }

        amounts.push(parsed);
      }

      const tx = await pool.addLiquidity(amounts);
      await tx.wait();

      await fetchBalances(address, provider);
      await fetchAllLPBalances(address, provider);
      await fetchLPTokenAmounts(address, provider);
      await fetchPoolBalances(provider);
      setMyDeposits((prev) => ({
        USDC: prev.USDC + Number(liqInputs.USDC || 0),
        EURC: prev.EURC + Number(liqInputs.EURC || 0),
        SWPRC: prev.SWPRC + Number(liqInputs.SWPRC || 0),
      }));

      setLiquiditySuccess({
        poolId: activePreset.id,
        type: "add",
        amounts: { ...liqInputs },
      });
      setPoolsView("positions");
      setShowAddLiquidity(false);
      setLiqInputs({ USDC: "", EURC: "", SWPRC: "" });
    } catch (err) {
      console.error(err);
      alert("Add liquidity failed");
    } finally {
      setLiqLoading(false);
    }
  }
  function closeAddLiquidity() {
    setShowAddLiquidity(false);
    setActivePreset(null);
    setLiqInputs({ USDC: "", EURC: "", SWPRC: "" });
  }

  async function handleRemoveLiquidity() {
    if (!address) {
      alert("Connect wallet first");
      return;
    }

    if (!removeLpAmount || Number(removeLpAmount) <= 0) {
      alert("Enter LP amount to remove");
      return;
    }

    try {
      setRemoveLoading(true);

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      // IMPORTANT: LP is 6-decimal based
      const lpParsed = BigInt(Math.floor(Number(removeLpAmount) * 1e6));

      const pool = new ethers.Contract(
        activePreset.poolAddress,
        POOL_ABI,
        signer
      );

      const tx = await pool.removeLiquidity(lpParsed);
      await tx.wait();

      await fetchBalances(address, provider);
      await fetchAllLPBalances(address, provider);
      await fetchLPTokenAmounts(address, provider);
      await fetchPoolBalances(provider);

      setLiquiditySuccess({
        poolId: activePreset.id,
        type: "remove",
        amount: removeLpAmount,
      });
      setShowRemoveLiquidity(false);
      setRemoveLpAmount("");
    } catch (err) {
      console.error(err);
      alert("Remove liquidity failed");
    } finally {
      setRemoveLoading(false);
    }
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
            {/* DESKTOP ONLY BUTTONS */}
            <button
              className="xBtn desktopOnly"
              onClick={() => window.open("https://x.com/swaparc_app", "_blank")}
            >
              𝕏
            </button>

            <button className="faucetBtn desktopOnly" onClick={openFaucet}>
              💧 Get Faucet
            </button>

            {!address ? (
              <button className="connectBtn" onClick={connectWallet}>
                Connect Wallet
              </button>
            ) : (
              <button className="walletPill" onClick={disconnectWallet}>
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
                <>
                  <div
                    className="historyToggleRow"
                    style={{ marginBottom: 16 }}
                  >
                    <button
                      className={`historyToggleBtn ${
                        poolsView === "positions" ? "active" : ""
                      }`}
                      onClick={() => setPoolsView("positions")}
                    >
                      MY POSITIONS
                    </button>

                    <button
                      className={`historyToggleBtn ${
                        poolsView === "all" ? "active" : ""
                      }`}
                      onClick={() => setPoolsView("all")}
                    >
                      ALL POOLS
                    </button>
                  </div>

                  <div style={{ width: "100%" }}>
                    {poolsView === "positions" && (
                      <div className="neon-card">
                        <h4
                          style={{
                            marginBottom: 12,
                            textAlign: "center",
                            color: "cyan",
                          }}
                        >
                          My Positions
                        </h4>

                        {!address ? (
                          <p className="muted">
                            Connect wallet to view positions.
                          </p>
                        ) : POOLS.filter((p) => lpBalances[p.id] > 0).length ===
                          0 ? (
                          <div className="comingSoon">
                            <p className="muted">
                              You have no active liquidity positions
                            </p>
                            <button
                              className="primaryBtn"
                              onClick={() => setPoolsView("all")}
                            >
                              Add Liquidity
                            </button>
                          </div>
                        ) : (
                          POOLS.filter((p) => lpBalances[p.id] > 0).map((p) => (
                            <div key={p.id} className="positionCard neon-card">
                              <div className="poolHeader">
                                <div className="poolTokens">
                                  {p.tokens.map((t, i) => (
                                    <span className="token-badge">
                                      <img
                                        src={TOKEN_LOGOS[t]}
                                        alt={t}
                                        style={{
                                          width: "100%",
                                          height: "100%",
                                          borderRadius: "50%",
                                        }}
                                      />
                                    </span>
                                  ))}
                                </div>
                                <div className="poolName">{p.name}</div>
                              </div>

                              <div className="poolLiquidity">
                                <div className="liquidityTitle">
                                  YOUR LIQUIDITY
                                </div>

                                {lpTokenAmounts[p.id] ? (
                                  Object.entries(lpTokenAmounts[p.id]).map(
                                    ([sym, amt]) => (
                                      <div key={sym} className="liquidityRow">
                                        <span>{sym}</span>
                                        <strong>{amt.toFixed(4)}</strong>
                                      </div>
                                    )
                                  )
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </div>

                              <div className="txActions">
                                <button
                                  className="secondaryBtn"
                                  onClick={() => {
                                    setActivePreset(p);
                                    setShowRemoveLiquidity(true);
                                  }}
                                >
                                  Remove
                                </button>

                                <button
                                  className="primaryBtn"
                                  onClick={() => {
                                    setActivePreset(p);
                                    setShowAddLiquidity(true);
                                  }}
                                >
                                  Add
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {poolsView === "all" && (
                      <div>
                        <div className="poolsGrid">
                          {POOLS.map((p) => {
                            const tvl = poolBalances[p.id] || 0;

                            return (
                              <div key={p.id} className="poolCard neon-card">
                                <div className="poolHeader">
                                  <div className="poolTokens">
                                    {p.tokens.map((t, i) => (
                                      <span className="token-badge">
                                        <img
                                          src={TOKEN_LOGOS[t]}
                                          alt={t}
                                          style={{
                                            width: "100%",
                                            height: "100%",
                                            borderRadius: "50%",
                                          }}
                                        />
                                      </span>
                                    ))}
                                  </div>
                                  <div className="poolName">{p.name}</div>
                                </div>

                                <div className="poolLiquidity">
                                  <div className="liquidityTitle">
                                    TOTAL LIQUIDITY
                                  </div>

                                  {poolTokenBalances[p.id] ? (
                                    Object.entries(poolTokenBalances[p.id]).map(
                                      ([sym, amt]) => (
                                        <div key={sym} className="liquidityRow">
                                          <span>{sym}</span>
                                          <strong>{amt.toFixed(2)}</strong>
                                        </div>
                                      )
                                    )
                                  ) : (
                                    <span className="muted">—</span>
                                  )}
                                </div>

                                <div className="poolStat">
                                  <span>Fee</span>
                                  <strong>0.30%</strong>
                                </div>

                                <button
                                  className="primaryBtn"
                                  onClick={() => {
                                    setActivePreset(p);
                                    setPoolsView("positions");
                                    setShowAddLiquidity(true);
                                  }}
                                >
                                  Deposit
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        {Object.keys(poolBalances).length > 0 && (
                          <div className="neon-card" style={{ marginTop: 28 }}>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                              }}
                            >
                              <div>
                                <div className="muted">Total TVL</div>
                                <strong style={{ fontSize: 22 }}>
                                  $
                                  {totalPoolTVL().toLocaleString(undefined, {
                                    maximumFractionDigits: 2,
                                  })}
                                </strong>
                              </div>

                              <div style={{ textAlign: "right" }}>
                                <div className="muted">Pools</div>
                                <strong>{POOLS.length}</strong>
                              </div>
                            </div>
                          </div>
                        )}
                        <div
                          className="muted"
                          style={{
                            marginTop: 18,
                            textAlign: "center",
                            fontStyle: "italic",
                          }}
                        >
                          Liquidity and TVL are fetched directly from on-chain
                          balances
                        </div>
                      </div>
                    )}
                  </div>
                </>
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

      {liquiditySuccess && (
        <div className="modalOverlay">
          <div className="txModal liquidityModal">
            <h3 style={{ color: "#9ff6ff", marginBottom: 14 }}>
              {liquiditySuccess.type === "add"
                ? "Liquidity Added Successfully"
                : "Liquidity Removed Successfully"}
            </h3>

            {liquiditySuccess.type === "add" &&
              Object.entries(liquiditySuccess.amounts).map(
                ([sym, amt]) =>
                  amt &&
                  Number(amt) > 0 && (
                    <div key={sym} className="txRow">
                      <span>{sym}</span>
                      <strong>{Number(amt).toFixed(4)}</strong>
                    </div>
                  )
              )}

            {liquiditySuccess.type === "remove" && (
              <div className="txRow">
                <span>LP Removed</span>
                <strong>{liquiditySuccess.amount}</strong>
              </div>
            )}

            <div className="txActions">
              <button
                className="primaryBtn"
                onClick={() => setLiquiditySuccess(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {mobileMenuOpen && (
        <div className="mobileMenuOverlay">
          <div className="mobileMenu">
            <button
              onClick={() => {
                setActiveTab("swap");
                setMobileMenuOpen(false);
              }}
            >
              Swap
            </button>

            <button
              onClick={() => {
                setActiveTab("history");
                setMobileMenuOpen(false);
              }}
            >
              History
            </button>

            <button
              onClick={() => {
                setActiveTab("pools");
                setMobileMenuOpen(false);
              }}
            >
              Pools
            </button>

            <button onClick={openFaucet}>💧 Get Faucet</button>

            <button
              onClick={() => window.open("https://x.com/swaparc_app", "_blank")}
            >
              𝕏 Twitter
            </button>

            <button
              className="closeBtn"
              onClick={() => setMobileMenuOpen(false)}
            >
              Close ✕
            </button>
          </div>
        </div>
      )}
      {showAddLiquidity && (
        <div className="modalOverlay">
          <div className="txModal liquidityModal">
            <h3>Add Liquidity</h3>

            {(activePreset?.tokens || ["USDC", "EURC", "SWPRC"]).map((sym) => (
              <div key={sym} style={{ marginBottom: 14 }}>
                <div
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <span>{sym}</span>
                  <span>Balance: {balances[sym]}</span>
                </div>

                <input
                  className="swapInput"
                  placeholder="0.00"
                  value={liqInputs[sym] || ""}
                  onChange={(e) =>
                    setLiqInputs((p) => ({ ...p, [sym]: e.target.value }))
                  }
                />

                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  ≈ $
                  {liqInputs[sym] && prices[sym]
                    ? (Number(liqInputs[sym]) * prices[sym]).toFixed(2)
                    : "0.00"}
                </div>
              </div>
            ))}

            <div className="txActions">
              <button className="secondaryBtn" onClick={closeAddLiquidity}>
                Cancel
              </button>

              <button
                className="primaryBtn"
                onClick={handleAddLiquidity}
                disabled={liqLoading}
              >
                {liqLoading ? "Supplying..." : "Supply"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showRemoveLiquidity && (
        <div className="modalOverlay">
          <div className="txModal liquidityModal">
            <h3>Remove Liquidity</h3>

            <p className="muted">Enter LP amount to remove</p>

            <input
              className="swapInput"
              placeholder="LP amount"
              value={removeLpAmount}
              onChange={(e) => setRemoveLpAmount(e.target.value)}
              style={{ marginBottom: 12 }}
            />

            <p className="muted">
              Your LP balance:{" "}
              {activePreset ? lpBalances[activePreset.id]?.toFixed(6) : "—"}
            </p>

            <div className="txActions">
              <button
                className="secondaryBtn"
                onClick={() => setShowRemoveLiquidity(false)}
              >
                Cancel
              </button>

              <button
                className="primaryBtn"
                onClick={handleRemoveLiquidity}
                disabled={removeLoading}
              >
                {removeLoading ? "Removing..." : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
