import { useEffect, useState, useRef, useMemo } from "react";
import { ethers } from "ethers";
import logo from "./assets/swaparc-logo.png";
import usdcLogo from "./assets/usdc.jpg";
import eurcLogo from "./assets/eurc.jpg";
import swprcLogo from "./assets/swprc.jpg";
import "./App.css";
import { getPrices } from "./priceFetcher";
import { CircleSigner } from "./utils/CircleSigner";

const ARC_CHAIN_ID_DEC = 5042002;
const ARC_CHAIN_ID_HEX = "0x4CEF52";
const CIRCLE_APP_ID = import.meta.env.VITE_CIRCLE_APP_ID || "";

console.log("Circle setup:", { CIRCLE_APP_ID });

import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";

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
  // Verified from Arcscan ABI: camelCase, only 1 param (no min_mint_amount)
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
  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  function openFaucet() {
    window.open("https://faucet.circle.com/", "_blank");
  }
  const tokenIndices = {
    USDC: 0,
    EURC: 1,
    SWPRC: 2,
  };

  // --- STATE DECLARATIONS (Moved up to avoid TDZ) ---
  const [address, setAddress] = useState(null);
  const [authMode, setAuthMode] = useState("wallet");
  const [circleWallet, setCircleWallet] = useState(null);
  const [circleWalletReady, setCircleWalletReady] = useState(false);
  const [circleLogin, setCircleLogin] = useState(null);
  const circleSdkRef = useRef(null);
  const userEmailRef = useRef(null);
  const circleExecResolverRef = useRef(null);

  const [activePreset, setActivePreset] = useState(null);
  const [network, setNetwork] = useState(null);
  const [poolTokenBalances, setPoolTokenBalances] = useState({});
  const [lpTokenAmounts, setLpTokenAmounts] = useState({});
  const [lpBalances, setLpBalances] = useState({});
  const [lpLoading, setLpLoading] = useState(false);
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
  const [slippageTolerance, setSlippageTolerance] = useState(1); // percent, default 1%
  const [expectedOutputNum, setExpectedOutputNum] = useState(null); // raw number for calculations
  const [expectedOutputRaw, setExpectedOutputRaw] = useState(null); // bigint wei for min_dy
  const [swapPoolTokenBalances, setSwapPoolTokenBalances] = useState({}); // { USDC, EURC, SWPRC } for swap pool
  const [highImpactConfirmed, setHighImpactConfirmed] = useState(false);
  const [showSlippagePanel, setShowSlippagePanel] = useState(false);

  const [prices, setPrices] = useState({});
  // authMode moved up
  const [leaderboard, setLeaderboard] = useState({
    topSwapVolume: [],
    topSwapCount: [],
    topLPProvided: [],
  });
  const [showConnectMenu, setShowConnectMenu] = useState(false);
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [userEmail, setUserEmail] = useState(null);
  // circleWallet, circleWalletReady moved up

  useEffect(() => {
    if (authMode === "email" && circleWallet && circleWallet.address) {
      setAddress(circleWallet.address);
    }
  }, [authMode, circleWallet]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!activePreset?.lpToken) return;
      try {
        const provider = getReadProvider();
        const lp = new ethers.Contract(activePreset.lpToken, LP_ABI, provider);
        const dec = await lp.decimals();
        if (!cancelled) setLpDecimals(Number(dec) || 18);
      } catch {
        if (!cancelled) setLpDecimals(18);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePreset?.lpToken]);

  const [profileStats, setProfileStats] = useState(null);
  const [userId, setUserId] = useState(null);
  const [leaderboardTab, setLeaderboardTab] = useState("swaps");
  const [portfolioValue, setPortfolioValue] = useState(0);
  const [tokenPrices, setTokenPrices] = useState({});
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailStep, setEmailStep] = useState(1);
  const [emailInput, setEmailInput] = useState("");
  const [emailStatus, setEmailStatus] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailErrorDetails, setEmailErrorDetails] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [circleDeviceId, setCircleDeviceId] = useState("");
  const [circleDeviceToken, setCircleDeviceToken] = useState("");
  const [circleDeviceEncryptionKey, setCircleDeviceEncryptionKey] = useState("");
  const [circleOtpToken, setCircleOtpToken] = useState("");
  // circleLogin moved up
  const [circleChallengeId, setCircleChallengeId] = useState(null);
  const [circleExecPrompt, setCircleExecPrompt] = useState(null);
  const [circleExecLoading, setCircleExecLoading] = useState(false);
  const [circleExecError, setCircleExecError] = useState("");
  // userEmailRef, circleExecResolverRef moved up

  // --- HELPER FUNCTIONS (Safe to use state now) ---
  function getReadProvider() {
    // Prefer a higher-limit public RPC to avoid 429/-32007 rate limits in production
    // Disable JSON-RPC batching: some free-tier providers (drpc) reject batches > 3.
    return new ethers.JsonRpcProvider(
      "https://arc-testnet.drpc.org",
      undefined,
      { batchMaxCount: 1 }
    );
  }

  function getActiveWalletAddress() {
    if (authMode === "email" && circleWallet) return circleWallet.address;
    return address;
  }

  function isCircleMode() {
    return authMode === "email" && !!circleWallet;
  }

  function requireCircleAuth() {
    if (!isCircleMode()) throw new Error("Circle wallet not connected");
    const userToken = window.localStorage.getItem("circle_user_token");
    const encryptionKey = window.localStorage.getItem("circle_encryption_key");
    if (!userToken || !encryptionKey) throw new Error("Circle session expired. Please login again.");
    return { userToken, encryptionKey, walletId: circleWallet.walletId };
  }

  async function ensureCircleDeviceId() {
    if (typeof window === "undefined") return null;
    if (!circleSdkRef.current) {
      console.warn("[Circle] ensureCircleDeviceId: SDK not ready");
      return null;
    }

    // Reuse cached deviceId if present (prevents repeated SDK calls / improves UX)
    try {
      const cached = window.localStorage.getItem("circle_device_id") || window.localStorage.getItem("deviceId");
      if (cached && typeof cached === "string" && cached.length > 8) {
        setCircleDeviceId(cached);
        return cached;
      }
    } catch {
      // ignore storage failures
    }

    const getWithRetry = async (retries = 5, delayMs = 900) => {
      try {
        setEmailStatus(`Performing device security check… (${retries + 1} attempts left)`);
        const id = await circleSdkRef.current.getDeviceId();
        if (!id) throw new Error("Received empty deviceId");
        console.log("[Circle] deviceId from sdk.getDeviceId()", id);
        try {
          window.localStorage.setItem("circle_device_id", id);
          window.localStorage.setItem("deviceId", id);
        } catch {
          // ignore storage failures
        }
        setCircleDeviceId(id);
        setEmailStatus("");
        return id;
      } catch (err) {
        if (retries > 0) {
          console.warn(`[Circle] getDeviceId failed, retrying... (${retries} left)`);
          await new Promise((res) => setTimeout(res, delayMs));
          // Exponential backoff (caps at 6s)
          const nextDelay = Math.min(6000, Math.floor(delayMs * 1.6));
          return getWithRetry(retries - 1, nextDelay);
        }
        throw err;
      }
    };

    try {
      return await getWithRetry();
    } catch (error) {
      console.error("[Circle] getDeviceId failed:", error);
      setEmailStatus("");
      let msg = "Device security check failed. ";

      const isBrave =
        (navigator.brave && (await navigator.brave.isBrave())) || false;
      
      if (isBrave) {
        msg += "Brave detected: turn off Shields for this site (lion icon), then retry. ";
      } else {
        msg += "Please allow third‑party cookies (or disable strict tracking prevention) and retry. ";
      }

      msg += "If this persists, ensure `https://www.swaparc.app` is added to Circle Allowed Domains (Configurator).";

      setEmailError(msg);
      return null;
    }
  }

  // Fetch On-Chain Prices Once (Shared Source)
  useEffect(() => {
    userEmailRef.current = userEmail;
  }, [userEmail]);

  // Persist Gmail Session
  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedEmail = window.localStorage.getItem("circle_user_email");
    const storedToken = window.localStorage.getItem("circle_user_token");
    
    // Only attempt restore if we are not already connected via wallet (MetaMask)
    // and not already in email mode.
    if (!storedEmail || !storedToken || address || authMode === "email") return;

    let cancelled = false;

    (async () => {
      try {
        console.log("[App] Attempting to restore Circle session for:", storedEmail);
        const res = await fetch(
          "/api/circle/user/get-or-create-wallet",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: storedEmail,
              userToken: storedToken,
            }),
          }
        );

        const data = await res.json();
        if (!res.ok) {
          console.warn("[App] Session restore failed:", data.error);
          return;
        }

        if (cancelled) return;

        console.log("[App] Session restored!", data);
        setUserEmail(storedEmail);
        if (data && data.walletId && data.address && data.blockchain) {
          setCircleWallet({
            walletId: data.walletId,
            address: data.address,
            blockchain: data.blockchain,
          });
          setCircleWalletReady(true);
          setAuthMode("email");
        } else if (
            data &&
            Array.isArray(data.wallets) &&
            data.wallets[0] &&
            data.wallets[0].id
        ) {
            setCircleWallet({
                walletId: data.wallets[0].id,
                address: data.wallets[0].address,
                blockchain: data.wallets[0].blockchain,
            });
            setCircleWalletReady(true);
            setAuthMode("email");
        }
      } catch (e) {
        console.error("[App] Session restore error", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, authMode]);


  // Fetch On-Chain Prices Once (Shared Source)
  useEffect(() => {
    let mounted = true;
    async function fetchOnChainPrices() {
      // Always use public provider for prices to avoid wallet dependencies
      const provider = getReadProvider();

      try {
        const prices = {};
        // Use Promise.all for speed
        await Promise.all(
          INITIAL_TOKENS.map(async (t) => {
            prices[t.symbol] = await getOnchainPriceInUSDC(provider, t.symbol);
          })
        );

        if (mounted) {
          setTokenPrices(prices);
        }
      } catch (e) {
        console.warn("Token price fetch failed", e);
      }
    }

    fetchOnChainPrices();
    const interval = setInterval(fetchOnChainPrices, 30000); // Refresh every 30s
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const calculatedPortfolioValue = useMemo(() => {
    if (!balances || Object.keys(balances).length === 0) return 0;
    if (!tokenPrices || Object.keys(tokenPrices).length === 0) return 0;

    let total = 0;
    // Wallet Balances
    ["USDC", "EURC", "SWPRC"].forEach((sym) => {
      const bal = Number(balances[sym] || 0);
      const price = Number(tokenPrices[sym] || 0);
      total += bal * price;
    });

    // LP Positions Value (added to portfolio?)
    // User requirement: "Total Portfolio Value = USDC_value + EURC_value + SWPRC_value"
    // But usually portfolio includes LP. The prompt separates them.
    // "Total Portfolio Value = ..." strictly lists the 3 tokens.
    // However, previous code added LP value. I will follow the strict formula first,
    // but usually users want to see total net worth.
    // Wait, the prompt says "Total Portfolio Value = USDC_value + EURC_value + SWPRC_value".
    // It does NOT explicitly say "+ LP Value".
    // BUT, the previous implementation did.
    // I will include LP value if it was there, or check context.
    // Actually, looking at the previous code: `let totalPortfolio = totalLpUsd;` then added tokens.
    // So I should probably include LP value in "Portfolio Value" if that's what the UI expects.
    // The prompt defines "PORTFOLIO TOTAL VALUE" separate from "LP VALUE".
    // I will stick to the prompt's formula for the variable, but maybe the UI sums them?
    // Let's look at `calculatedLpTotalValue` first.
    return total;
  }, [balances, tokenPrices]);

  // LP Value Calculation (Memoized)
  const calculatedLpTotalValue = useMemo(() => {
    if (!lpTokenAmounts || Object.keys(lpTokenAmounts).length === 0) return 0;
    if (!tokenPrices || Object.keys(tokenPrices).length === 0) return 0;

    let total = 0;
    Object.values(lpTokenAmounts).forEach((pool) => {
      Object.entries(pool).forEach(([sym, amt]) => {
        const price = Number(tokenPrices[sym] || 0);
        const amount = Number(amt);
        if (!isNaN(price) && !isNaN(amount)) {
            total += amount * price;
        }
      });
    });
    return total;
  }, [lpTokenAmounts, tokenPrices]);

  // Combined Portfolio for Display (if needed)
  const displayPortfolioValue =
    calculatedPortfolioValue + calculatedLpTotalValue;

  // Persist LP Value
  useEffect(() => {
    if (calculatedLpTotalValue > 0 && userId) {
      // Only update if significantly different
      if (
        profileStats &&
        Math.abs(
          Number(profileStats.lpProvided || 0) - calculatedLpTotalValue
        ) > 0.01
      ) {
        // Update local state immediately for UI responsiveness
        setProfileStats((prev) => ({
          ...prev,
          lpProvided: calculatedLpTotalValue,
        }));

        // Persist to backend
        fetch("/api/profile/updateLp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: userId,
            lpTotalValue: calculatedLpTotalValue,
          }),
        }).catch(console.error);
      }
    }
  }, [calculatedLpTotalValue, userId, profileStats]);

  // Badge Logic (Memoized)
  const badgeState = useMemo(() => {
    if (!profileStats) return { earlySwaparcer: false };

    const count = Number(profileStats.swapCount || 0);
    const vol = Number(profileStats.swapVolume || 0);
    // Use calculated LP value for immediate feedback, or profile?
    // User says "Badge state must recompute whenever... lpProvided changes".
    // calculatedLpTotalValue is the most up-to-date.
    const lp = calculatedLpTotalValue;

    const isEarlySwaparcer = count >= 100 || vol >= 10000 || lp >= 1000;
    return { earlySwaparcer: isEarlySwaparcer };
  }, [profileStats, calculatedLpTotalValue]);

  useEffect(() => {
    // Prevent race condition: Only calculate totals AFTER both balances AND prices are available.
    // This effect is now replaced by useMemo above.
    // I will remove the old effect logic in the next step or here.
    setPortfolioValue(displayPortfolioValue);
  }, [displayPortfolioValue]);

  async function fetchLeaderboard() {
    try {
      const res = await fetch("/api/profile/leaderboard");
      const data = await res.json();
      setLeaderboard(data);
    } catch (err) {
      console.error("Failed to fetch leaderboard", err);
    }
  }

  async function getProfileData(addr) {
    const targetAddr = addr || address;
    if (!targetAddr) return null;
    try {
      const res = await fetch(`/api/profile/get?userId=${targetAddr}`);
      if (res.ok) {
        const data = await res.json();
        // Unwrap the profile object from the response
        if (data && data.success && data.profile) {
          return data.profile;
        }
        // Fallback: check if the response was the profile itself (legacy)
        if (data && data.userId) {
          return data;
        }
      }
      return await createNewProfileData(targetAddr);
    } catch (err) {
      console.error("Failed to fetch profile", err);
      return null;
    }
  }

  async function createNewProfileData(addr) {
    try {
      const payload = {
        userId: addr,
        username: "Anonymous",
        walletId: addr,
      };
      const res = await fetch("/api/profile/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        return {
          ...payload,
          swapCount: 0,
          swapVolume: 0,
          lpProvided: 0,
          badges: [],
        };
      }
    } catch (err) {
      console.error("Failed to create profile", err);
    }
    return null;
  }

  async function fetchProfile(addr) {
    const target = addr || address;
    if (!target) return;

    console.log("[DEX] Fetching profile for:", target);
    const data = await getProfileData(target);
    if (data) {
      console.log("[DEX] Profile data received:", data);
      setProfileStats({
        swapCount: 0,
        swapVolume: 0,
        lpProvided: 0,
        badges: [],
        username: "Anon User",
        ...data
      });
      setUserId(data.userId || target);
    }
  }

  async function createNewProfile(addr) {
    const data = await createNewProfileData(addr);
    if (data) {
      setProfileStats(data);
      setUserId(addr);
    }
  }

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editForm, setEditForm] = useState({ username: "", avatar: "" });
  const fileInputRef = useRef(null);

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 500000) {
      // 500KB limit
      alert("Image too large (max 500KB)");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      setEditForm((prev) => ({ ...prev, avatar: ev.target.result }));
    };
    reader.readAsDataURL(file);
  }

  function startEditing() {
    if (!profileStats) return;
    setEditForm({
      username: profileStats.username || "",
      avatar: profileStats.avatar || "",
    });
    setIsEditingProfile(true);
  }

  async function saveProfile() {
    const targetId = userId || address;
    if (!targetId) return;

    try {
      const res = await fetch("/api/profile/updateIdentity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: targetId,
          username: editForm.username,
          avatar: editForm.avatar,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setIsEditingProfile(false);
        fetchProfile();
      } else {
        alert("Save failed");
      }
    } catch (err) {
      console.error(err);
      alert("Save failed");
    }
  }

  useEffect(() => {
    if (activeTab === "leaderboard") fetchLeaderboard();

    (async () => {
      // Use fallback if window.ethereum is not available
        const provider = window.ethereum
          ? new ethers.BrowserProvider(window.ethereum)
          : getReadProvider();

      // For Circle users, prefer the public provider for stability
      const activeProvider = isCircleMode() ? getReadProvider() : provider;
      const walletAddr = getActiveWalletAddress();

      if (activeTab === "pools") {
        fetchPoolBalances(activeProvider).catch(console.warn);
      }

      if (!walletAddr) return;

      try {
        // Always fetch balances when address is connected, regardless of tab
        const balData = await getBalances(walletAddr, activeProvider);
        setBalances(balData || {});

        if (activeTab === "profile") {
          // Run simultaneous fetches (Prices handled globally now)
          const [profData, lpBalData, lpAmountsResult] =
            await Promise.all([
              getProfileData(walletAddr),
              getAllLPBalancesData(walletAddr, activeProvider),
              getLpTokenAmountsData(walletAddr, activeProvider),
            ]);

          // Patch profile with latest LP if available and valid
          let finalProfile = profData;

          // Batch Updates
          if (finalProfile) {
            setProfileStats(finalProfile);
            setUserId(finalProfile.userId);
          }
          setLpBalances(lpBalData || {});
          setLpTokenAmounts(lpAmountsResult?.amounts || {});
        } else if (activeTab === "pools") {
          // Also fetch LP data for pools tab
          const [lpBalData, lpAmountsResult] = await Promise.all([
            getAllLPBalancesData(walletAddr, activeProvider),
            getLpTokenAmountsData(walletAddr, activeProvider),
          ]);
          setLpBalances(lpBalData || {});
          setLpTokenAmounts(lpAmountsResult?.amounts || {});
        }
      } catch (e) {
        console.error("Profile/Balance load error", e);
      }
    })();
  }, [activeTab, address, circleWallet]); // Added circleWallet dependency

  useEffect(() => {
    if (!profileStats) return;
    if (!swapHistory || swapHistory.length === 0) return;
    if (!tokenPrices || Object.keys(tokenPrices).length === 0) return;
  
    const successful = swapHistory.filter(
      (t) => !t.status || t.status === "success"
    );
  
    let rebuiltCount = 0;
    let rebuiltVolume = 0;
  
    for (const tx of successful) {
      const token = tx.fromToken || tx.token || "USDC";
      const amt = Number(tx.fromAmount || tx.amount || 0);
      const price = Number(tokenPrices[token] || 1);
  
      if (amt > 0) {
        rebuiltCount += 1;
        rebuiltVolume += amt * price;
      }
    }
  
    const backendCount = Number(profileStats.swapCount || 0);
    const walletAddr = getActiveWalletAddress();
  
    // ONLY repair fresh profiles
    /*
    if (backendCount === 0 && rebuiltCount > 0) {
      setProfileStats((prev) => ({
        ...prev,
        swapCount: rebuiltCount,
        swapVolume: rebuiltVolume,
      }));
  
      fetch("/api/profile/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userId || walletAddr,
          swapCount: rebuiltCount,
          swapVolume: rebuiltVolume,
        }),
      }).catch(console.error);
    }
    */
  }, [swapHistory, tokenPrices, profileStats, userId, address, circleWallet]);
  

  useEffect(() => {
    const walletAddr = getActiveWalletAddress();
    if (walletAddr) {
      fetchProfile(walletAddr);
    } else {
      setProfileStats(null);
      setUserId(null);
    }
  }, [address, circleWallet]);

  useEffect(() => {
    if (!CIRCLE_APP_ID) {
      console.warn("Circle SDK init skipped: missing VITE_CIRCLE_APP_ID");
      return;
    }

    if (circleSdkRef.current) {
      setSdkReady(true);
      return;
    }

    let cancelled = false;

    // Global listener to debug Circle SDK messages
    const messageHandler = (event) => {
      // Filter for relevant Circle messages if possible, but log all for now to debug
      if (event.origin === "https://circle.com" || event.origin.includes("circle")) {
         console.log("[Circle] Window Message:", event.data);
      }
    };
    window.addEventListener("message", messageHandler);

    const initSdk = async () => {
      try {
        console.log("[Circle] init appId:", CIRCLE_APP_ID);

        const onLoginComplete = async (error, result) => {
          console.log("[Circle] onLoginComplete TRIGGERED", { error, result, isMounted: isMountedRef.current });
          if (!isMountedRef.current) return;

          if (error || !result) {
            const err = error || {};
            const message =
              err && err.message ? err.message : "Email authentication failed";
            console.error("[Circle] Login failed:", message);
            setEmailError(message);
            setEmailStatus("");
            setCircleLogin(null);
            setEmailLoading(false);
            return;
          }

          const loginData = {
            userId: result.userId || null,
            userToken: result.userToken,
            encryptionKey: result.encryptionKey,
            refreshToken: result.refreshToken || null,
          };

          console.log("[Circle] Login success, data:", loginData);
          setCircleLogin(loginData);
          setEmailError("");
          
          // Force UI update to show progress
          setEmailStatus("Email verified. Authenticating...");
          
          // Ensure we persist the session immediately
          if (typeof window !== "undefined") {
             window.localStorage.setItem("circle_user_token", loginData.userToken);
             window.localStorage.setItem("circle_encryption_key", loginData.encryptionKey);
          }

          const email = userEmailRef.current;

          if (!email) {
            setEmailStatus("Email verified.");
            setEmailLoading(false);
            return;
          }

          try {
            setEmailStatus("Email verified. Checking wallet...");

            let res = await fetch("/api/circle/user/get-or-create-wallet", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email,
                userToken: loginData.userToken,
              }),
            });

            let data = await res.json();
            console.log("[Circle] get-or-create-wallet response:", res.status, data);

            if (res.status === 404) {
              await initializeAndCreateCircleWallet(loginData);
              return;
            }

            if (!res.ok) {
              setEmailError(
                data.error || data.message || "Failed to load Circle wallet"
              );
              setEmailStatus("");
              setEmailLoading(false);
              return;
            }

            if (data && data.walletId && data.address && data.blockchain) {
              setCircleWallet({
                walletId: data.walletId,
                address: data.address,
                blockchain: data.blockchain,
              });
            } else if (
              data &&
              Array.isArray(data.wallets) &&
              data.wallets[0] &&
              data.wallets[0].id
            ) {
              setCircleWallet({
                walletId: data.wallets[0].id,
                address: data.wallets[0].address,
                blockchain: data.wallets[0].blockchain,
              });
            } else {
              throw new Error("Unexpected wallet response shape");
            }
            setCircleWalletReady(true);
            setAuthMode("email");
            setEmailStatus("Circle wallet ready");
            setShowEmailModal(false);
            setEmailLoading(false);
          } catch (e) {
            console.error("[Circle] Wallet load error:", e);
            setEmailError("Failed to load Circle wallet");
            setEmailStatus("");
            setEmailLoading(false);
          }
        };

        const sdk = new W3SSdk(
          {
            appSettings: { appId: CIRCLE_APP_ID },
          },
          onLoginComplete
        );

        if (cancelled) return;
        circleSdkRef.current = sdk;
        setSdkReady(true);
      } catch (err) {
        console.error("[Circle] SDK init failed", err);
        if (!cancelled) setEmailError("Circle email connect is unavailable");
      }
    };

    initSdk();

    return () => {
      cancelled = true;
      circleSdkRef.current = null;
      setSdkReady(false);
      window.removeEventListener("message", messageHandler);
    };
  }, []);

  useEffect(() => {
    // Do not pre-warm deviceId; retrieve it when user clicks "Send OTP".
  }, [sdkReady]);

  useEffect(() => {
    console.log("Circle debug state", {
      appId: CIRCLE_APP_ID,
      sdkReady,
      circleDeviceId,
    });
  }, [sdkReady, circleDeviceId]);

  // Removed duplicate session restore effect
  // The primary restore logic is now handled by the useEffect above
  // around line 450.


  async function getAllLPBalancesData(user, provider) {
    const balances = {};
    for (const p of POOLS) {
      try {
        const lp = new ethers.Contract(p.lpToken, LP_ABI, provider);
        const raw = await lp.balanceOf(user);
        const dec = await lp.decimals();
        balances[p.id] = Number(ethers.formatUnits(raw, dec));
      } catch {
        balances[p.id] = 0;
      }
    }
    return balances;
  }

  async function fetchAllLPBalances(user, provider) {
    const balances = await getAllLPBalancesData(user, provider);
    setLpBalances(balances);
  }

  async function refreshUserLiquidityData(userAddr) {
    if (!userAddr) return;
    const provider = getReadProvider();
    setLpLoading(true);
    try {
      await fetchBalances(userAddr, provider);
      await fetchAllLPBalances(userAddr, provider);
      await fetchLPTokenAmounts(userAddr, provider);
      await fetchPoolBalances(provider);
    } finally {
      setLpLoading(false);
    }
  }

  const lastLiquidityRefreshRef = useRef(null);
  useEffect(() => {
    const userAddr = getActiveWalletAddress();
    if (!userAddr) return;
    // Only refresh when the active wallet changes or becomes ready
    if (lastLiquidityRefreshRef.current === userAddr) return;
    // Avoid fetching before Circle wallet is actually ready
    if (authMode === "email" && (!circleWalletReady || !circleWallet?.address)) return;
    lastLiquidityRefreshRef.current = userAddr;
    refreshUserLiquidityData(userAddr).catch((e) =>
      console.warn("Liquidity refresh failed", e)
    );
  }, [authMode, circleWalletReady, circleWallet?.address, address]);

  async function handleClaimRewards(poolPreset) {
    console.log("[CircleTx] Starting Claim Rewards...");
    const walletAddr = getActiveWalletAddress();
    if (!walletAddr) {
      alert("Connect wallet first");
      return;
    }

    try {
      const provider = isCircleMode() ? getReadProvider() : (await getSigner()).provider || new ethers.BrowserProvider(window.ethereum);

      if (isCircleMode()) {
        const claimTx = buildClaimRewardsCall(poolPreset.poolAddress);
        
        const { hash: txHash } = await executeCircleContractAction({
          contractAddress: claimTx.contractAddress,
          abiFunctionSignature: claimTx.abiFunctionSignature,
          abiParameters: claimTx.abiParameters,
          title: "Confirm claim rewards in Circle",
        });
        console.log("[CircleTx] Claim Rewards confirmed:", txHash);
      } else {
        // --- Injected Wallet Path ---
        const signer = await getSigner();
        const pool = new ethers.Contract(poolPreset.poolAddress, POOL_ABI, signer);
        const tx = await pool.claimRewards();
        await tx.wait();
        console.log("[WalletTx] Claim Rewards confirmed:", tx.hash);
      }

      await fetchBalances(walletAddr, provider);
      await fetchAllLPBalances(walletAddr, provider);

      alert("Rewards claimed!");
    } catch (err) {
      console.error("[App] Claim rewards failed:", err);
      alert("Claim rewards failed: " + (err.message || err));
    }
  }

  async function getLpTokenAmountsData(user, provider) {
    const result = {};
    let totalLpUsd = 0;

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
          const userShareAmount = poolAmount * share;

          result[p.id][sym] = userShareAmount;

          // Calculate USD value for this portion using already-fetched tokenPrices
          // (avoid extra on-chain calls that can trigger RPC rate limits and UI flicker)
          const price = Number(tokenPrices?.[sym] || 0);
          totalLpUsd += userShareAmount * price;
        }
      } catch (e) {
        console.warn("LP breakdown failed for", p.id, e);
      }
    }
    return { amounts: result, totalLpUsd };
  }

  async function fetchLPTokenAmounts(user, provider) {
    const { amounts, totalLpUsd } = await getLpTokenAmountsData(user, provider);
    setLpTokenAmounts(amounts);

    // Persist LP stat to backend
    try {
      await fetch("/api/profile/updateLp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user, lpTotalValue: totalLpUsd }),
      });
      if (activeTab === "profile") fetchProfile(user);
    } catch (err) {
      console.warn("Failed to update LP stats", err);
    }
  }
  async function getOnchainPriceInUSDC(provider, fromSymbol) {
    if (fromSymbol === "USDC") return 1;

    try {
      const pool = new ethers.Contract(SWAP_POOL_ADDRESS, POOL_ABI, provider);

      const fromIndex = tokenIndices[fromSymbol];
      const usdcIndex = tokenIndices.USDC;

      const token = INITIAL_TOKENS.find((t) => t.symbol === fromSymbol);
      const tokenC = new ethers.Contract(token.address, ERC20_ABI, provider);
      const decimals = await tokenC.decimals();

      const oneToken = ethers.parseUnits("1", decimals);
      const dy = await pool.get_dy(fromIndex, usdcIndex, oneToken);

      return Number(ethers.formatUnits(dy, 6));
    } catch (e) {
      console.warn("Price fetch failed for", fromSymbol);
      return 0;
    }
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

          const priceInUSDC = await getOnchainPriceInUSDC(provider, sym);
          tvl += bal * priceInUSDC;
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
    let debounceTimer = null;

    async function estimateOut() {
      if (
        !swapAmount ||
        Number(swapAmount) <= 0 ||
        swapFrom === swapTo ||
        Object.keys(tokenIndices).length === 0
      ) {
        setEstimatedTo("");
        setExpectedOutputNum(null);
        setExpectedOutputRaw(null);
        setSwapPoolTokenBalances({});
        return;
      }

      // 400ms debounce to avoid 429 rate limit on rapid typing
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        try {
          const provider = new ethers.JsonRpcProvider("https://rpc.testnet.arc.network");

          const fromToken = tokens.find((t) => t.symbol === swapFrom);
          const toToken = tokens.find((t) => t.symbol === swapTo);
          if (!fromToken || !toToken) return;

          const i = tokenIndices[swapFrom];
          const j = tokenIndices[swapTo];

          // 1. Get Decimals (Cached in local memory to save RPC calls)
          const getDecimals = async (token) => {
            if (token.symbol === "USDC" || token.symbol === "EURC" || token.symbol === "USDG") return 6;
            const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
            return await contract.decimals().catch(() => 18);
          };

          const decimalsIn = await getDecimals(fromToken);
          const amountIn = ethers.parseUnits(swapAmount, decimalsIn);

          // 2. Query Pool
          const pool = new ethers.Contract(SWAP_POOL_ADDRESS, POOL_ABI, provider);
          const dy = await pool.get_dy(i, j, amountIn);

          const decimalsOut = await getDecimals(toToken);
          const human = Number(ethers.formatUnits(dy, decimalsOut));

          const formatted =
            human >= 1000
              ? human.toLocaleString(undefined, { maximumFractionDigits: 2 })
              : human.toLocaleString(undefined, { maximumFractionDigits: 6 });

          if (mounted) {
            setEstimatedTo(formatted);
            setExpectedOutputNum(human);
            setExpectedOutputRaw(dy);
          }

          // 3. Fetch swap pool balances (Consolidated to one call)
          try {
            const rawBalances = await pool.getBalances();
            const symbols = ["USDC", "EURC", "SWPRC"];
            const nextBalances = {};
            for (let idx = 0; idx < symbols.length && idx < rawBalances.length; idx++) {
              const sym = symbols[idx];
              const tok = tokens.find((t) => t.symbol === sym);
              const dec = tok ? await getDecimals(tok) : 6;
              nextBalances[sym] = Number(ethers.formatUnits(rawBalances[idx], dec));
            }
            if (mounted) setSwapPoolTokenBalances(nextBalances);
          } catch (balErr) {
            console.warn("Swap pool balances fetch failed", balErr);
          }
        } catch (e) {
          console.warn("On-chain estimate failed", e);
          if (mounted && e.message.includes("429")) {
            setQuote("Too many requests. Please wait a moment...");
          }
        }
      }, 400); 
    }

    estimateOut();

    return () => {
      mounted = false;
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [swapAmount, swapFrom, swapTo, tokens, tokenIndices]);

  useEffect(() => {
    setHighImpactConfirmed(false);
  }, [swapFrom, swapTo, swapAmount]);

  // Derived swap metrics for slippage, price impact, and liquidity checks
  const swapSummary = useMemo(() => {
    const amountNum = Number(swapAmount) || 0;
    const expected = expectedOutputNum;
    const poolFrom = swapPoolTokenBalances[swapFrom];
    const poolTo = swapPoolTokenBalances[swapTo];
    const clampedSlippage = Math.max(0.1, Math.min(100, Number(slippageTolerance) || 1));
    const slippagePct = clampedSlippage / 100;

    const minimumReceivedNum = expected != null ? expected * (1 - slippagePct) : null;
    let priceImpactPercent = null;
    if (expected != null && amountNum > 0 && poolFrom > 0 && poolTo > 0) {
      const executionRate = expected / amountNum;
      const spotRate = poolTo / poolFrom;
      priceImpactPercent = (1 - executionRate / spotRate) * 100;
    }
    const poolLiquidityFrom = poolFrom ?? 0;
    const tradeSizeTooLarge = poolLiquidityFrom > 0 && amountNum > poolLiquidityFrom * 0.1;
    const isHighImpact = priceImpactPercent != null && priceImpactPercent > 10;
    const isExtremeImpact = priceImpactPercent != null && priceImpactPercent > 25;

    return {
      minimumReceivedNum,
      priceImpactPercent,
      poolLiquidityFrom,
      tradeSizeTooLarge,
      isHighImpact,
      isExtremeImpact,
      slippagePct: clampedSlippage.toFixed(1),
      slippageRaw: clampedSlippage,
    };
  }, [swapAmount, swapFrom, swapTo, expectedOutputNum, swapPoolTokenBalances, slippageTolerance]);

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
      // 4902: Chain not found. Some wallets might throw generic errors with "Unrecognized chain".
      if (
        err.code === 4902 ||
        (err.message && err.message.includes("Unrecognized chain"))
      ) {
        try {
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

          // Retry switching after adding
          await ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: ARC_CHAIN_ID_HEX }],
          });

          return true;
        } catch (addError) {
          console.error("Failed to add or switch to Arc Testnet", addError);
          return false;
        }
      }
      console.error("Failed to switch to Arc Testnet", err);
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

      // 1. Ensure we are on Arc Testnet (add/switch if needed)
      const ok = await ensureArcNetwork();
      if (!ok) {
        setStatus("Please add or switch to Arc Testnet");
        return;
      }

      // 2. Request accounts (wallet popup)
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
    // Also clear Circle state if it was active, just in case
    if (authMode === "email") {
      disconnectEmail();
    }
  }

  function disconnectEmail() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("circle_device_id");
      window.localStorage.removeItem("deviceId");
      window.localStorage.removeItem("circle_user_email");
      window.localStorage.removeItem("circle_user_token");
      window.localStorage.removeItem("circle_encryption_key");
      window.localStorage.removeItem("circle_device_token");
      window.localStorage.removeItem("circle_device_encryption_key");
      window.localStorage.removeItem("circle_otp_token");
      window.localStorage.removeItem("circle_app_id");
    }
    setCircleDeviceId("");
    setCircleDeviceToken("");
    setCircleDeviceEncryptionKey("");
    setCircleOtpToken("");
    setUserEmail(null);
    setCircleLogin(null);
    setCircleWallet(null);
    setCircleWalletReady(false);
    setAuthMode("wallet");
    setShowEmailModal(false);
    setEmailStep(1);
    setEmailStatus("");
    setEmailError("");
    setAddress(null); // Ensure address is cleared
  }

  function exportCircleWallet() {
    if (!circleWallet) return;
    const payload = {
      walletId: circleWallet.walletId,
      address: circleWallet.address,
      blockchain: circleWallet.blockchain,
      email: userEmail || null,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "circle-wallet.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  async function getBalances(userAddress, provider) {
    const tokenBalances = {};
    // Use fallback provider if none passed
    const p = provider || (window.ethereum 
      ? new ethers.BrowserProvider(window.ethereum) 
      : new ethers.JsonRpcProvider("https://rpc.testnet.arc.network"));

    for (const t of tokens) {
      try {
        const tokenContract = new ethers.Contract(
          t.address,
          ERC20_ABI,
          p
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
    return tokenBalances;
  }

  async function fetchBalances(userAddress, provider) {
    try {
      const b = await getBalances(userAddress, provider);
      setBalances(b);
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

  // Helper to get the correct signer (MetaMask or Circle)
  async function getSigner() {
    if (authMode === "email" && circleWallet) {
      // Return a custom CircleSigner
      const provider = new ethers.JsonRpcProvider("https://rpc.testnet.arc.network");
      const signer = new CircleSigner(circleWallet.walletId, circleSdkRef.current, provider);
      signer.setAddress(circleWallet.address);
      return signer;
    }

    // Default MetaMask
    const provider = new ethers.BrowserProvider(window.ethereum);
    return await provider.getSigner();
  }

  // --- Circle Transaction Layer ---
  // Moved up to prevent TDZ.
  // See top of App function for declarations.
  
  // --- TRANSACTION BUILDERS (Shared) ---
  function buildApproveCall(tokenAddress, spenderAddress, amount) {
    return {
      contractAddress: tokenAddress,
      abiFunctionSignature: "approve(address,uint256)",
      abiParameters: [spenderAddress.toString(), amount.toString()],
      amount: "0", // No ETH value sent
    };
  }

  function buildSwapCall(poolAddress, i, j, dx) {
    return {
      contractAddress: poolAddress,
      abiFunctionSignature: "swap(uint256,uint256,uint256)",
      abiParameters: [i.toString(), j.toString(), dx.toString()],
      amount: "0",
    };
  }

  function buildAddLiquidityCall(poolAddress, amounts) {
    // Verified from Arcscan ABI: addLiquidity(uint256[]) — camelCase, no min_mint_amount param
    return {
      contractAddress: poolAddress,
      abiFunctionSignature: "addLiquidity(uint256[])",
      // Dynamic uint256[] — pass as nested array so Circle encodes correctly
      abiParameters: [amounts.map(String)],
      amount: "0",
    };
  }

  function buildRemoveLiquidityCall(poolAddress, lpAmount) {
    // Verified from Arcscan ABI: removeLiquidity(uint256) — camelCase, 1 param only
    return {
      contractAddress: poolAddress,
      abiFunctionSignature: "removeLiquidity(uint256)",
      abiParameters: [lpAmount.toString()],
      amount: "0",
    };
  }

  function buildClaimRewardsCall(poolAddress) {
    return {
      contractAddress: poolAddress,
      abiFunctionSignature: "claimRewards()",
      abiParameters: [],
      amount: "0",
    };
  }

  /**
   * executeCircleContractAction
   * Production-grade helper to execute a contract action via Circle User-Controlled flow.
   * Now accepts pre-encoded callData to match injected wallet flow exactly.
   */
  async function executeCircleContractAction({
    contractAddress,
    abiFunctionSignature,
    abiParameters,
    amount = "0",
    title = "Confirm in Circle",
  }) {
    console.log(`[CircleTx] Initiating: ${title} on ${contractAddress}`);
    const { userToken, encryptionKey, walletId } = requireCircleAuth();

    // 1. Initiate challenge on backend
    const res = await fetch("/api/circle/user/execute-contract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userToken,
        walletId,
        contractAddress,
        abiFunctionSignature,
        abiParameters,
        amount,
      }),
    });

    const data = await res.json().catch(() => ({}));
    
    // Handle session expiry
    if (res.status === 401 || (data.error && data.error.includes("Session expired"))) {
      console.warn("Session expired, logging out...");
      disconnectEmail();
      alert("Session expired. Please log in again.");
      window.location.reload();
      return;
    }

    if (!res.ok) {
      console.error("[CircleTx] Initiation failed:", data);
      throw new Error(data.error || "Failed to initiate Circle transaction");
    }

    const challengeId = data.challengeId;
    if (!challengeId) throw new Error("No challengeId returned from backend");

    // 2. Prompt user for PIN/Challenge via SDK
    await executeCircleChallengeViaPrompt(challengeId, title);

    // 3. Poll for transaction hash
    console.log("[CircleChallenge] Polling for tx hash...");
    const txHash = await waitForCircleTxHash(challengeId);
    if (!txHash) {
      throw new Error("Timeout: Transaction submitted but hash not found. Please check history.");
    }

    console.log(`[CircleTx] Hash received: ${txHash}`);

    // 4. Wait for on-chain confirmation (only if we have a real hash)
    if (txHash !== "SUBMITTED") {
      const provider = getReadProvider();
      setQuote("Waiting for confirmation...");
      await provider.waitForTransaction(txHash, 1, 180000);
    } else {
      // Challenge confirmed on-chain but hash not yet indexed by Circle API.
      // The transaction was submitted successfully — safe to move to next step.
      setQuote("Transaction submitted...");
      await new Promise((r) => setTimeout(r, 3000)); // short wait for state to settle
    }

    return { hash: txHash };
  }
  
  // Clean up unused function initiateCircleContractExecution if present
  // Removed initiateCircleContractExecution as it is superseded by executeCircleContractAction



  async function executeCircleChallenge(challengeId, retryCount = 0) {
    const MAX_RETRIES = 3;
    const userToken = window.localStorage.getItem("circle_user_token");
    const encryptionKey = window.localStorage.getItem("circle_encryption_key");
    if (!userToken || !encryptionKey) {
      throw new Error("Circle session missing. Please login again.");
    }
    if (!circleSdkRef.current) {
      throw new Error("Circle SDK not ready");
    }
    circleSdkRef.current.setAuthentication({ userToken, encryptionKey });
    try {
      return await new Promise((resolve, reject) => {
        circleSdkRef.current.execute(challengeId, (error, result) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(result);
        });
      });
    } catch (error) {
      // Error 155706 = Circle iframe failed to load (network/cookie/timing issue)
      // Retry automatically with exponential backoff — most retries succeed within 1-2 attempts
      if (error.code === 155706 && retryCount < MAX_RETRIES) {
        const delay = 1000 * (retryCount + 1); // 1s, 2s, 3s
        console.warn(`[Circle] SDK error 155706, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
        await new Promise((r) => setTimeout(r, delay));
        return executeCircleChallenge(challengeId, retryCount + 1);
      }
      // All retries exhausted or unrelated error
      if (error.code === 155706) {
        throw new Error(
          "Connection issue with Circle. Please ensure third-party cookies are allowed for this site and try again."
        );
      }
      throw new Error(error.message || "Circle confirmation failed");
    }
  }

  async function executeCircleChallengeViaPrompt(challengeId, title) {
    if (!challengeId) throw new Error("Missing challengeId");
    setCircleExecError("");
    setCircleExecLoading(false);
    setCircleExecPrompt({ title: title || "Confirm in Circle", challengeId });
    return await new Promise((resolve, reject) => {
      circleExecResolverRef.current = { resolve, reject };
    });
  }

  async function confirmCircleExecution() {
    if (!circleExecPrompt?.challengeId) return;
    if (!circleExecResolverRef.current) return;
    setCircleExecLoading(true);
    setCircleExecError("");
    try {
      await executeCircleChallenge(circleExecPrompt.challengeId);
      const { resolve } = circleExecResolverRef.current;
      circleExecResolverRef.current = null;
      setCircleExecPrompt(null);
      setCircleExecLoading(false);
      resolve(true);
    } catch (e) {
      setCircleExecLoading(false);
      setCircleExecError(e?.message || String(e));
    }
  }

  function cancelCircleExecution() {
    if (circleExecResolverRef.current?.reject) {
      circleExecResolverRef.current.reject(new Error("Circle execution cancelled"));
    }
    circleExecResolverRef.current = null;
    setCircleExecPrompt(null);
    setCircleExecLoading(false);
    setCircleExecError("");
  }

  // initiateCircleContractExecution removed - superseded by executeCircleContractAction

  async function waitForCircleTxHash(challengeId, maxAttempts = 60) {
    const userToken = window.localStorage.getItem("circle_user_token");
    const TERMINAL_STATES = ["COMPLETE", "CONFIRMED", "FAILED", "CANCELLED"];

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const res = await fetch(
        `/api/circle/user/challenge-status?challengeId=${encodeURIComponent(challengeId)}`,
        {
          headers: { "X-User-Token": userToken },
        }
      );
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const hash = data?.transactionHash;
        const state = data?.state || data?.challenge?.state || data?.challenge?.status || "";

        console.log(`[CircleChallenge] poll #${attempt + 1} state="${state}" hash=${hash || "none"}`);

        // If we have a proper txHash, return it immediately
        if (hash && typeof hash === "string" && hash.startsWith("0x")) return hash;

        // If challenge reached a terminal state without a hash yet (e.g. waiting for indexer),
        // wait one more cycle then return null — this avoids infinite loops.
        if (TERMINAL_STATES.some(s => state.toUpperCase().includes(s))) {
          // Wait one extra cycle to give indexer a chance to surface the hash
          await new Promise((r) => setTimeout(r, 3000));
          const retry = await fetch(
            `/api/circle/user/challenge-status?challengeId=${encodeURIComponent(challengeId)}`,
            { headers: { "X-User-Token": userToken } }
          );
          if (retry.ok) {
            const retryData = await retry.json().catch(() => ({}));
            const retryHash = retryData?.transactionHash;
            if (retryHash && typeof retryHash === "string" && retryHash.startsWith("0x")) return retryHash;
          }
          // Return "CONFIRMED" sentinel so callers can detect success without a hash
          // (Arc testnet may not surface txHash immediately via Circle's indexer)
          console.warn("[CircleChallenge] Challenge reached terminal state but no txHash yet. Treating as submitted.");
          return "SUBMITTED";
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return null;
  }

  // executeCircleTxAndWait was a helper from the old flow - removed to avoid confusion.
  // Use executeCircleContractAction directly.

  async function performSwapEmail() {
    console.log("[CircleTx] Starting Swap...");
    if (!isCircleMode()) throw new Error("Circle wallet not ready");

    const provider = getReadProvider();
    const fromToken = tokens.find((t) => t.symbol === swapFrom);
    const toToken = tokens.find((t) => t.symbol === swapTo);
    if (!fromToken || !toToken) throw new Error("Token not found");

    // 1. Prepare Amount & Decimals (Read from public provider)
    const tokenInReader = new ethers.Contract(fromToken.address, ERC20_ABI, provider);
    const decimalsIn = await tokenInReader.decimals();
    const amountIn = ethers.parseUnits(swapAmount, decimalsIn);
    console.log(`[CircleTx] Swap Amount: ${amountIn.toString()} (${swapAmount} ${swapFrom})`);

    // 2. Check Allowance
    const walletAddr = getActiveWalletAddress();
    const allowance = await tokenInReader.allowance(walletAddr, SWAP_POOL_ADDRESS);
    console.log(`[CircleTx] Allowance: ${allowance.toString()}`);

    if (BigInt(allowance) < BigInt(amountIn)) {
      setQuote(`Approving ${swapFrom} for trading...`);
      
      const MAX_UINT256 = ethers.MaxUint256;
      const approveTx = buildApproveCall(fromToken.address, SWAP_POOL_ADDRESS, MAX_UINT256);
      
      // Execute Approve via Circle
      await executeCircleContractAction({
        contractAddress: approveTx.contractAddress,
        abiFunctionSignature: approveTx.abiFunctionSignature,
        abiParameters: approveTx.abiParameters,
        title: `Approve ${swapFrom} in Circle`,
      });
      console.log("[CircleTx] Approve confirmed. Waiting for RPC sync...");
      // Poll until allowance is reflected on-chain to avoid 'insufficient allowance' reverts on slow nodes
      let allowanceConfirmed = false;
      for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const newAllowance = await tokenInReader.allowance(walletAddr, SWAP_POOL_ADDRESS);
          if (newAllowance >= MAX_UINT256 / 2n) {
              allowanceConfirmed = true;
              break;
          }
      }
      if (!allowanceConfirmed) {
          throw new Error("Blockchain is slow to sync approval. Please try your swap again in a few seconds.");
      }
    }

    // 3. Estimate Output (Read-only)
    const poolReader = new ethers.Contract(SWAP_POOL_ADDRESS, POOL_ABI, provider);
    let expectedOut = null;
    try {
      expectedOut = await poolReader.get_dy(tokenIndices[swapFrom], tokenIndices[swapTo], amountIn);
    } catch (e) {
      console.warn("[CircleRead] get_dy failed:", e);
    }

    if (!expectedOut || expectedOut === 0n) {
      throw new Error("Could not get expected output. Try a smaller amount.");
    }

    // Slippage: minimum received (contract will revert if output < min_dy)
    const slippagePct = Math.max(0.1, Math.min(100, Number(slippageTolerance) || 1));
    const min_dy = (expectedOut * BigInt(Math.floor(100 - slippagePct))) / 100n;

    // Trade size check: swap amount must not exceed 10% of pool liquidity
    const rawBalances = await poolReader.getBalances();
    const fromIdx = tokenIndices[swapFrom];
    const poolFromBalance = rawBalances[fromIdx];
    if (poolFromBalance != null && poolFromBalance > 0n && amountIn > (poolFromBalance * 10n) / 100n) {
      throw new Error("Trade size is too large for current liquidity.");
    }

    // High price impact: require extra confirmation if > 25%
    const toIdx = tokenIndices[swapTo];
    const poolToBalance = rawBalances[toIdx];
    if (poolFromBalance != null && poolToBalance != null && poolFromBalance > 0n && poolToBalance > 0n) {
      const amountNum = Number(swapAmount) || 0;
      const expectedHumanForImpact = Number(ethers.formatUnits(expectedOut, 6));
      const poolFromNum = Number(ethers.formatUnits(poolFromBalance, await tokenInReader.decimals()));
      const poolToNum = Number(ethers.formatUnits(poolToBalance, 6));
      const executionRate = expectedHumanForImpact / amountNum;
      const spotRate = poolToNum / poolFromNum;
      const priceImpactPercent = (1 - executionRate / spotRate) * 100;
      if (priceImpactPercent > 25 && !highImpactConfirmed) {
        throw new Error("Please confirm high price impact in the swap panel before continuing.");
      }
    }

    let expectedHuman = null;
    const decOut = 6;
    expectedHuman = Number(ethers.formatUnits(expectedOut, decOut));

    setQuote(
      expectedHuman
        ? `Estimated: ~${expectedHuman.toFixed(6)} ${swapTo}. Min: ~${Number(ethers.formatUnits(min_dy, decOut)).toFixed(6)}. Sending...`
        : "Sending swap..."
    );

    // 4. Execute Swap via Circle 
    // Contract does not natively support min_dy, so we pass 3 arguments
    const swapTx = buildSwapCall(
      SWAP_POOL_ADDRESS,
      tokenIndices[swapFrom],
      tokenIndices[swapTo],
      amountIn
    );

    const { hash: txHash } = await executeCircleContractAction({
      contractAddress: swapTx.contractAddress,
      abiFunctionSignature: swapTx.abiFunctionSignature,
      abiParameters: swapTx.abiParameters,
      title: "Confirm swap in Circle",
    });

    setQuote("Submitted! Waiting for confirmation...");
    console.log("[CircleTx] Swap confirmed:", txHash);

    // 5. Post-Swap Updates (History, Modal, Profile, Balances)
    const pendingTx = {
      fromToken: swapFrom,
      fromAmount: swapAmount,
      toToken: swapTo,
      toAmount: expectedHuman ? expectedHuman.toFixed(6) : "0",
      txUrl: `https://testnet.arcscan.app/tx/${txHash}`,
      hash: txHash,
      timestamp: Date.now(),
      status: "success",
    };

    setSwapHistory((prev) => [pendingTx, ...prev]);

    setTxModal({
      status: "success",
      fromToken: swapFrom,
      fromAmount: swapAmount,
      toToken: swapTo,
      toAmount: expectedHuman ? expectedHuman.toFixed(6) : estimatedTo || "0",
      txHash,
    });

    setQuote(`Swap succeeded — tx ${txHash}`);

    // Update Profile Stats
    try {
      const price = tokenPrices[swapFrom] || 1;
      const usdValue = Number(swapAmount) * Number(price);
      await fetch("/api/profile/addSwap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: walletAddr,
          amount: usdValue,
        }),
      });
      setTimeout(() => {
        fetchProfile(walletAddr);
      }, 3000);
    } catch (err) {
      console.warn("[App] Profile update failed", err);
    }

    // Refresh Balances
    await fetchBalances(walletAddr, provider);
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
      if (authMode === "email") {
        await performSwapEmail();
        return;
      }
      // Use our custom signer helper
      const signer = await getSigner();
      // For reads, we can use the signer's provider or a default one
      const provider = signer.provider || new ethers.BrowserProvider(window.ethereum);

      const fromToken = tokens.find((t) => t.symbol === swapFrom);
      const toToken = tokens.find((t) => t.symbol === swapTo);
      if (!fromToken || !toToken) throw new Error("Token not found");

      const i = tokenIndices[swapFrom];
      const j = tokenIndices[swapTo];

      // Contract instance connected to our signer
      const tokenIn = new ethers.Contract(fromToken.address, ERC20_ABI, signer);
      const decimalsIn = await tokenIn.decimals(); // This is a read, uses provider
      const amountIn = ethers.parseUnits(swapAmount, decimalsIn);

      const allowance = await tokenIn.allowance(
        await signer.getAddress(),
        SWAP_POOL_ADDRESS
      );

      if (BigInt(allowance) < BigInt(amountIn)) {
        setQuote(`Approving ${swapFrom} for trading...`);
        const txA = await tokenIn.approve(SWAP_POOL_ADDRESS, ethers.MaxUint256);
        setQuote("Waiting for approval confirmation...");
        await txA.wait(1);
        
        // Add a small delay for public RPC nodes to catch up on state BEFORE the swap simulation
        await new Promise((r) => setTimeout(r, 2000));
      }

      // 2. Perform Swap
      const pool = new ethers.Contract(SWAP_POOL_ADDRESS, POOL_ABI, signer);
      const poolReader = new ethers.Contract(SWAP_POOL_ADDRESS, POOL_ABI, getReadProvider());

      const fromIdx = tokenIndices[fromToken.symbol];
      const toIdx = tokenIndices[toToken.symbol];

      let expectedOut = null;
      try {
        expectedOut = await poolReader.get_dy(fromIdx, toIdx, amountIn);
      } catch (e) {
        console.warn("get_dy failed:", e);
      }

      if (!expectedOut || expectedOut === 0n) {
        throw new Error("Could not get expected output. Try a smaller amount.");
      }

      const slippagePct = Math.max(0.1, Math.min(100, Number(slippageTolerance) || 1));
      const min_dy = (expectedOut * BigInt(Math.floor(100 - slippagePct))) / 100n;

      const rawBalances = await poolReader.getBalances();
      const poolFromBalance = rawBalances[fromIdx];
      if (poolFromBalance != null && poolFromBalance > 0n && amountIn > (poolFromBalance * 10n) / 100n) {
        throw new Error("Trade size is too large for current liquidity.");
      }

      const poolToBalance = rawBalances[toIdx];
      if (poolFromBalance != null && poolToBalance != null && poolFromBalance > 0n && poolToBalance > 0n) {
        const decOut = 6;
        const expectedHumanForImpact = Number(ethers.formatUnits(expectedOut, decOut));
        const amountNum = Number(swapAmount) || 0;
        const poolFromNum = Number(ethers.formatUnits(poolFromBalance, decimalsIn));
        const poolToNum = Number(ethers.formatUnits(poolToBalance, decOut));
        const executionRate = expectedHumanForImpact / amountNum;
        const spotRate = poolToNum / poolFromNum;
        const priceImpactPercent = (1 - executionRate / spotRate) * 100;
        if (priceImpactPercent > 25 && !highImpactConfirmed) {
          throw new Error("Please confirm high price impact in the swap panel before continuing.");
        }
      }

      let expectedHuman = Number(ethers.formatUnits(expectedOut, 6));

      setQuote(
        expectedHuman
          ? `Estimated: ~${expectedHuman.toFixed(6)} ${swapTo}. Min: ~${Number(ethers.formatUnits(min_dy, 6)).toFixed(6)}. Sending...`
          : "Sending swap..."
      );

      // Execute Swap (contract does not support min_dy natively, so we pass 3 arguments)
      const tx = await pool.swap(fromIdx, toIdx, amountIn);
      
      setQuote(`Submitted! Waiting for confirmation...`);
      console.log("Swap TX submitted:", tx.hash);
      
      // Save pending tx to localStorage so we don't lose it if user refreshes
      const pendingTx = {
          fromToken: swapFrom,
          fromAmount: swapAmount,
          toToken: swapTo,
          toAmount: expectedHuman ? expectedHuman.toFixed(6) : "0",
          txUrl: `https://testnet.arcscan.app/tx/${tx.hash}`,
          hash: tx.hash,
          timestamp: Date.now(),
          status: "pending"
      };
      
      // Add to local history immediately
      setSwapHistory((prev) => [pendingTx, ...prev]);
      
      // Wait for confirmation using our custom wait() logic
      await tx.wait();
      console.log("Swap TX confirmed!");

      const txUrl = `https://testnet.arcscan.app/tx/${tx.hash}`;
      
      // Update history item to success
      setSwapHistory((prev) => prev.map(item => item.hash === tx.hash ? { ...item, status: "success" } : item));

      setTxModal({
        status: "success",
        fromToken: swapFrom,
        fromAmount: swapAmount,
        toToken: swapTo,
        toAmount: expectedHuman ? expectedHuman.toFixed(6) : estimatedTo || "0",
        txHash: tx.hash,
      });

      setQuote(`Swap succeeded — tx ${tx.hash}`);

      // Update progression
      try {
        const userAddr = await signer.getAddress();
        // We do NOT call /api/profile/addSwap here for Wallet Connect.
        // liveSwapIndexer.js handles normal injected wallet swaps on-chain automatically.
        // Doing it here would cause double-counting!
        setTimeout(() => {
          fetchProfile(userAddr);
        }, 3000);
      } catch (err) {
        console.warn("Profile update failed", err);
      }

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

  async function loadCircleWallet(userToken) {
    try {
      const res = await fetch("/api/circle/user/wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEmailError(data.error || "Failed to load Circle wallet");
        return;
      }
      const wallets = data.wallets || [];
      if (!wallets.length) {
        setEmailError("No Circle wallet found");
        return;
      }
      const w = wallets[0];
      setCircleWallet({
        walletId: w.id,
        address: w.address,
        blockchain: w.blockchain,
      });
      setCircleWalletReady(true);
      setAuthMode("email");
      setEmailStatus("Circle wallet ready");
      setShowEmailModal(false);
    } catch (e) {
      setEmailError("Failed to load Circle wallet");
    }
  }

  async function initializeAndCreateCircleWallet(loginData) {
    if (!loginData || !loginData.userToken || !loginData.encryptionKey) return;
    if (!circleSdkRef.current) return;

    try {
      setEmailStatus("Initializing Circle user...");
      setEmailLoading(true);
      setEmailError("");

      // --- Step 1: Initialize User (PIN Setup) ---
      const desiredBlockchain = "ARC-TESTNET";
      const desiredAccountType = "SCA";
      let initChallengeId = null;
      const resInit = await fetch("/api/circle/user/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userToken: loginData.userToken,
          accountType: desiredAccountType,
          blockchains: [desiredBlockchain],
        }),
      });
      const dataInit = await resInit.json();

      if (resInit.ok && dataInit.challengeId) {
        initChallengeId = dataInit.challengeId;
        console.log("[Circle] Received init challengeId:", initChallengeId);
      } else if (
        dataInit.error &&
        dataInit.error.includes("already been initialized")
      ) {
        console.log("[Circle] User already initialized, skipping PIN setup.");
      } else {
        throw new Error(dataInit.error || "Failed to initialize Circle user");
      }

      // Set Authentication for SDK
      circleSdkRef.current.setAuthentication({
        userToken: loginData.userToken,
        encryptionKey: loginData.encryptionKey,
      });

      // Execute PIN Setup if needed
      if (initChallengeId) {
        if (!isMountedRef.current) return;
        setCircleChallengeId(initChallengeId);
        setEmailStatus("Setting up Circle PIN...");
        
        await new Promise((resolve, reject) => {
          circleSdkRef.current.execute(initChallengeId, (error, result) => {
            if (!isMountedRef.current) return;
            if (error) {
              reject(error);
              return;
            }
            console.log("[Circle] PIN setup complete:", result);
            resolve(result);
          });
        });
        if (!isMountedRef.current) return;
        setCircleChallengeId(null);
      }

      if (!isMountedRef.current) return;
      setEmailStatus("Loading Circle wallet...");

      const afterInitWalletsRes = await fetch("/api/circle/user/wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userToken: loginData.userToken }),
      });
      const afterInitWalletsData = await afterInitWalletsRes.json().catch(() => ({}));
      const afterInitWallets = afterInitWalletsData.wallets || [];

      if (!isMountedRef.current) return;

      if (Array.isArray(afterInitWallets) && afterInitWallets.length > 0) {
        const w = afterInitWallets[0];
        setCircleWallet({
          walletId: w.id,
          address: w.address,
          blockchain: w.blockchain,
        });
        setCircleWalletReady(true);
        setAuthMode("email");
        setEmailStatus("Circle wallet ready");
        setShowEmailModal(false);
        setEmailLoading(false);
        return;
      }

      setEmailStatus("Creating Circle wallet...");

      const resCreate = await fetch("/api/circle/user/create-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userToken: loginData.userToken,
          blockchain: desiredBlockchain,
        }),
      });

      const dataCreate = await resCreate.json();
      if (!resCreate.ok) {
        throw new Error(dataCreate.error || "Failed to create Circle wallet");
      }

      const createChallengeId = dataCreate.challengeId;
      console.log("[Circle] Wallet creation challenge:", createChallengeId);

      if (!isMountedRef.current) return;

      if (!createChallengeId) {
        await loadCircleWallet(loginData.userToken);
        setEmailLoading(false);
        return;
      }

      setCircleChallengeId(createChallengeId);

      circleSdkRef.current.execute(createChallengeId, async (error, result) => {
        if (!isMountedRef.current) return;
        if (error) {
          console.error("[Circle] Wallet creation failed:", error);
          setEmailError(error.message || "Failed to execute wallet creation");
          setEmailStatus("");
          setEmailLoading(false);
          return;
        }

        console.log("[Circle] Wallet creation complete:", result);
        setCircleChallengeId(null);
        setEmailStatus("Wallet created! Loading details...");

        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (!isMountedRef.current) return;
        await loadCircleWallet(loginData.userToken);
        setEmailLoading(false);
      });

    } catch (e) {
      console.error("[Circle] Init/Create flow failed:", e);
      setEmailError(e.message || "Circle email login failed");
      setEmailStatus("");
      setEmailLoading(false);
    }
  }

  function connectGmail() {
    setActiveTab("profile");
    setShowEmailModal(true);
    setEmailStep(1);
    setEmailStatus("");
    setEmailError("");
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
    console.log("[CircleTx] Starting Add Liquidity...");
    const walletAddr = getActiveWalletAddress();
    if (!walletAddr) {
      alert("Connect wallet first");
      return;
    }
    if (!activePreset || !activePreset.poolAddress) {
      alert("Select a pool first.");
      return;
    }

    try {
      setLiqLoading(true);
      const provider = getReadProvider();

      if (isCircleMode()) {
        const amounts = [];
        const { walletId } = requireCircleAuth();

        // 1. Approvals — approve max uint256 for each token, then WAIT for on-chain confirmation
        // Circle marks challenge COMPLETE immediately when signed (before tx is mined).
        // We must poll the allowance on-chain to confirm the approve settled before add_liquidity.
        for (const sym of activePreset.tokens) {
          const token = INITIAL_TOKENS.find((t) => t.symbol === sym);
          const rawVal = liqInputs[sym];

          if (!rawVal || Number(rawVal) <= 0) {
            amounts.push("0");
            continue;
          }

          const tokenReader = new ethers.Contract(token.address, ERC20_ABI, provider);
          const decimals = await tokenReader.decimals();
          const parsed = ethers.parseUnits(rawVal, decimals);
          amounts.push(parsed.toString());

          // Check existing allowance — skip approve if already sufficient
          const currentAllowance = await tokenReader.allowance(walletAddr, activePreset.poolAddress);
          if (BigInt(currentAllowance) >= BigInt(parsed)) {
            console.log(`[CircleTx] ${sym} allowance already sufficient (${currentAllowance.toString()}), skipping approve.`);
            continue;
          }

          // Need to approve — send max uint256
          const MAX_UINT256 = ethers.MaxUint256;
          setQuote(`Approving ${sym}...`);
          const approveTx = buildApproveCall(token.address, activePreset.poolAddress, MAX_UINT256);
          await executeCircleContractAction({
            contractAddress: approveTx.contractAddress,
            abiFunctionSignature: approveTx.abiFunctionSignature,
            abiParameters: approveTx.abiParameters,
            title: `Approve ${sym} in Circle`,
          });

          // Wait for the approval to actually land on-chain (up to 45 seconds)
          setQuote(`Waiting for ${sym} approval to confirm on-chain...`);
          const deadline = Date.now() + 45000;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 3000));
            const newAllowance = await tokenReader.allowance(walletAddr, activePreset.poolAddress);
            console.log(`[CircleTx] ${sym} on-chain allowance: ${newAllowance.toString()}`);
            if (BigInt(newAllowance) >= BigInt(parsed)) {
              console.log(`[CircleTx] ${sym} approve confirmed on-chain ✓`);
              break;
            }
          }
        }

        // 2. Add Liquidity via Circle
        // ABI: add_liquidity(uint256[] amounts, uint256 min_mint_amount)
        const addLiqTx = buildAddLiquidityCall(activePreset.poolAddress, amounts, 0);
        
        const { hash: txHash } = await executeCircleContractAction({
          contractAddress: addLiqTx.contractAddress,
          abiFunctionSignature: addLiqTx.abiFunctionSignature,
          abiParameters: addLiqTx.abiParameters,
          title: "Confirm add liquidity in Circle",
        });
        console.log("[CircleTx] Add Liquidity confirmed:", txHash);

        setLiquiditySuccess({
          poolId: activePreset.id,
          type: "add",
          amounts: { ...liqInputs },
          txHash,
        });

        // 3. Post-Action Updates
        // If txHash is "SUBMITTED" (chain confirmed but not yet indexed), wait before reading
        // on-chain LP balances — otherwise balanceOf returns 0 immediately.
        if (!txHash || txHash === "SUBMITTED") {
          setQuote("Waiting for chain to settle...");
          await new Promise((r) => setTimeout(r, 6000));
        }
        await refreshUserLiquidityData(walletAddr);

        setMyDeposits((prev) => ({
          ...prev,
          USDC: prev.USDC + Number(liqInputs.USDC || 0),
          EURC: prev.EURC + Number(liqInputs.EURC || 0),
          SWPRC: prev.SWPRC + Number(liqInputs.SWPRC || 0),
        }));
      } else {
        // --- Injected Wallet Path ---
        const signer = await getSigner();
        const amounts = [];

        // 2. Approvals
        for (const sym of activePreset.tokens) {
          const token = INITIAL_TOKENS.find((t) => t.symbol === sym);
          const rawVal = liqInputs[sym];

          if (!rawVal || Number(rawVal) <= 0) {
            amounts.push(0n);
            continue;
          }

          const tokenContract = new ethers.Contract(token.address, ERC20_ABI, signer);
          const decimals = await tokenContract.decimals();
          const parsed = ethers.parseUnits(rawVal, decimals);
          const allowance = await tokenContract.allowance(address, activePreset.poolAddress);

          if (BigInt(allowance) < BigInt(parsed)) {
            const txApprove = await tokenContract.approve(activePreset.poolAddress, parsed);
            await txApprove.wait();
          }
          amounts.push(parsed);
        }

        // 3. Add Liquidity
        const pool = new ethers.Contract(activePreset.poolAddress, POOL_ABI, signer);

        // Fixed ABI function name to addLiquidity (camelCase, 1 param)
        console.log("Adding liquidity with amounts:", amounts.map(a => a.toString()));
        const tx = await pool.addLiquidity(amounts); 
        
        console.log("Add Liquidity TX submitted:", tx.hash);
        
        // Update UI immediately (optimistic)
        setLiquiditySuccess({
          poolId: activePreset.id,
          type: "add",
          amounts: { ...liqInputs },
          status: "pending",
          txHash: tx.hash
        });
        
        await tx.wait();
        console.log("Add Liquidity TX confirmed!");
      }

      // 4. Post-Action Updates (runs for BOTH Circle and Injected Wallet)
      await refreshUserLiquidityData(walletAddr);
      setMyDeposits((prev) => ({
        ...prev,
        USDC: prev.USDC + Number(liqInputs.USDC || 0),
        EURC: prev.EURC + Number(liqInputs.EURC || 0),
        SWPRC: prev.SWPRC + Number(liqInputs.SWPRC || 0),
      }));

      // Only set success if not already set by Circle
      if (!isCircleMode()) {
        setLiquiditySuccess({
          poolId: activePreset.id,
          type: "add",
          amounts: { ...liqInputs },
        });
      }
      
      setPoolsView("positions");
      setShowAddLiquidity(false);
      setLiqInputs({ USDC: "", EURC: "", SWPRC: "" });
    } catch (err) {
      console.error("[App] Add liquidity failed:", err);
      alert("Add liquidity failed: " + (err.message || err));
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
    console.log("[CircleTx] Starting Remove Liquidity...");
    const walletAddr = getActiveWalletAddress();
    if (!walletAddr) {
      alert("Connect wallet first");
      return;
    }

    if (!removeLpAmount || Number(removeLpAmount) <= 0) {
      alert("Enter LP amount to remove");
      return;
    }

    try {
      setRemoveLoading(true);
      const provider = getReadProvider();

      // Use the LP token's actual decimals (varies by pool/token)
      let lpParsed;
      try {
        lpParsed = ethers.parseUnits(String(removeLpAmount), lpDecimals);
      } catch {
        throw new Error("Invalid LP amount");
      }
      let finalTxHash = null;

      if (isCircleMode()) {
        const { walletId } = requireCircleAuth();

        const removeLiqTx = buildRemoveLiquidityCall(activePreset.poolAddress, lpParsed);
        
        const { hash } = await executeCircleContractAction({
          contractAddress: removeLiqTx.contractAddress,
          abiFunctionSignature: removeLiqTx.abiFunctionSignature,
          abiParameters: removeLiqTx.abiParameters,
          title: "Confirm remove liquidity in Circle",
        });
        finalTxHash = hash;

        console.log("[CircleTx] Remove Liquidity confirmed:", finalTxHash);

        setLiquiditySuccess({
          poolId: activePreset.id,
          type: "remove",
          amount: removeLpAmount,
          txHash: finalTxHash,
        });
      } else {
        // --- Injected Wallet Path ---
        const signer = await getSigner();
        const pool = new ethers.Contract(activePreset.poolAddress, POOL_ABI, signer);

        const tx = await pool.removeLiquidity(lpParsed); 
        console.log("Remove Liquidity TX submitted:", tx.hash);
        finalTxHash = tx.hash;
        await tx.wait();
        console.log("Remove Liquidity TX confirmed!");

        setLiquiditySuccess({
          poolId: activePreset.id,
          type: "remove",
          amount: removeLpAmount,
        });
      }

      // 3. Post-Action Updates
      // Wait for chain to settle if tx isn't indexed yet
      const removeTxHash = finalTxHash || removeLpAmount;
      if (!removeTxHash || removeTxHash === "SUBMITTED") {
        await new Promise((r) => setTimeout(r, 6000));
      }
      await refreshUserLiquidityData(walletAddr);

      setShowRemoveLiquidity(false);
      setRemoveLpAmount("");
    } catch (err) {
      console.error("[App] Remove liquidity failed:", err);
      alert("Remove liquidity failed: " + (err.message || err));
    } finally {
      setRemoveLoading(false);
    }
  }

  return (
    <div className="app-page hybrid-page">
      {circleExecPrompt && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
          }}
        >
          <div
            style={{
              background: "#061426",
              borderRadius: 16,
              border: "1px solid rgba(0,255,255,0.4)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.7)",
              padding: 24,
              width: "100%",
              maxWidth: 420,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
                {circleExecPrompt.title || "Confirm in Circle"}
              </h2>
              <button
                onClick={cancelCircleExecution}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#aaa",
                  fontSize: "1.1rem",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: "0.9rem", color: "#e4f5ff", marginBottom: 12 }}>
              Click Continue to open Circle’s confirmation window.
            </div>

            {circleExecError && (
              <div
                style={{
                  marginBottom: 12,
                  padding: 10,
                  borderRadius: 8,
                  background: "rgba(255, 80, 80, 0.12)",
                  border: "1px solid rgba(255, 80, 80, 0.5)",
                  color: "#ffb3b3",
                  fontSize: "0.85rem",
                  whiteSpace: "pre-wrap",
                }}
              >
                {circleExecError}
              </div>
            )}

            <button
              disabled={circleExecLoading}
              onClick={confirmCircleExecution}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 999,
                border: "none",
                background: "linear-gradient(90deg,#00f0ff,#00ffb7)",
                color: "#001018",
                fontWeight: 700,
                cursor: circleExecLoading ? "not-allowed" : "pointer",
                opacity: circleExecLoading ? 0.6 : 1,
              }}
            >
              {circleExecLoading ? "Please wait..." : "Continue"}
            </button>
          </div>
        </div>
      )}
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
            {["profile", "swap", "pools", "arcpay"].map((t) => (
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

            {!address && authMode !== "email" && (
              <div style={{ position: "relative" }}>
                <button
                  className="connectCTA neon-btn"
                  onClick={() => setShowConnectMenu((v) => !v)}
                >
                  CONNECT
                </button>
                {showConnectMenu && (
                  <div
                    className="connectDropdown"
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "110%",
                      background: "rgba(14,32,56,0.95)",
                      border: "1px solid rgba(0, 255, 255, 0.35)",
                      boxShadow: "0 10px 30px rgba(0, 255, 255, 0.15)",
                      borderRadius: 12,
                      padding: 12,
                      width: 220,
                      zIndex: 50,
                      backdropFilter: "blur(6px)",
                    }}
                    onMouseLeave={() => setShowConnectMenu(false)}
                  >
                    <button
                      className="connectOption neon-btn"
                      style={{ width: "100%", marginBottom: 8 }}
                      onClick={async () => {
                        setShowConnectMenu(false);
                        connectWallet();
                      }}
                    >
                      Connect via Wallet
                    </button>
                    <button
                      className="connectOption neon-btn"
                      style={{ width: "100%" }}
                      onClick={() => {
                        setShowConnectMenu(false);
                        connectGmail();
                      }}
                    >
                      Connect via Gmail
                    </button>
                  </div>
                )}
              </div>
            )}

            {(address || (authMode === "email" && circleWallet)) && (
              <div style={{ position: "relative" }}>
                <button
                  className="walletPill"
                  onClick={() => setShowWalletMenu((prev) => !prev)}
                >
                  {authMode === "email" && circleWallet
                    ? `Circle · ${shortAddr(circleWallet.address)}`
                    : `Arc Testnet · ${shortAddr(address)}`}
                </button>
                {showWalletMenu && (
                  <div
                    className="connectDropdown"
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "110%",
                      background: "rgba(14,32,56,0.95)",
                      border: "1px solid rgba(0, 255, 255, 0.35)",
                      boxShadow: "0 10px 30px rgba(0, 255, 255, 0.15)",
                      borderRadius: 12,
                      padding: 12,
                      width: 220,
                      zIndex: 50,
                      backdropFilter: "blur(6px)",
                    }}
                    onMouseLeave={() => setShowWalletMenu(false)}
                  >
                    <button
                      className="connectOption neon-btn"
                      style={{ width: "100%", marginBottom: 8 }}
                      onClick={() => {
                        const addr =
                          authMode === "email" && circleWallet
                            ? circleWallet.address
                            : address;
                        if (addr) {
                          navigator.clipboard.writeText(addr);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }
                      }}
                    >
                      {copied ? "Copied!" : "Copy Address"}
                    </button>
                    <button
                      className="connectOption neon-btn"
                      style={{
                        width: "100%",
                        background: "rgba(255, 80, 80, 0.15)",
                        borderColor: "rgba(255, 80, 80, 0.4)",
                        color: "#ff8080",
                      }}
                      onClick={() => {
                        setShowWalletMenu(false);
                        if (authMode === "email") {
                          disconnectEmail();
                        } else {
                          disconnectWallet();
                        }
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
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

        {showEmailModal && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
            }}
          >
            <div
              style={{
                background: "#061426",
                borderRadius: 16,
                border: "1px solid rgba(0,255,255,0.4)",
                boxShadow: "0 20px 40px rgba(0,0,0,0.7)",
                padding: 24,
                width: "100%",
                maxWidth: 420,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                }}
              >
                <h2 style={{ margin: 0, fontSize: "1.2rem" }}>Connect via Email</h2>
                <button
                  onClick={() => {
                    setShowEmailModal(false);
                    setEmailStep(1);
                    setEmailStatus("");
                    setEmailError("");
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#aaa",
                    fontSize: "1.1rem",
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>

              {!CIRCLE_APP_ID && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: 10,
                    borderRadius: 8,
                    background: "rgba(255, 80, 80, 0.12)",
                    border: "1px solid rgba(255, 80, 80, 0.5)",
                    color: "#ffb3b3",
                    fontSize: "0.85rem",
                  }}
                >
                  Missing Circle App ID — go to Circle Console → Wallets → User Controlled → Configurator → App ID and set VITE_CIRCLE_APP_ID in your .env.
                </div>
              )}

              {emailStep === 1 && (
                <div>
                  <label
                    style={{
                      display: "block",
                      marginBottom: 8,
                      fontSize: "0.9rem",
                    }}
                  >
                    Email address
                  </label>
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="you@example.com"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid rgba(0,255,255,0.4)",
                      background: "rgba(3,16,32,0.9)",
                      color: "#e4f5ff",
                      marginBottom: 12,
                    }}
                  />
                  <button
                    disabled={emailLoading || !sdkReady}
                    onClick={async () => {
                      if (!sdkReady || !circleSdkRef.current) {
                        setEmailError(
                          "Email login is not ready yet. Please wait a moment."
                        );
                        console.warn("Send OTP blocked: SDK not ready");
                        return;
                      }
                      if (!emailInput) {
                        setEmailError("Enter an email address");
                        console.warn("Send OTP blocked: missing email");
                        return;
                      }

                      try {
                        setEmailLoading(true);
                        setEmailError("");
                        setEmailErrorDetails("");
                        setEmailStatus("Requesting OTP...");
                        setUserEmail(emailInput);

                        const deviceIdToUse = await ensureCircleDeviceId();
                        
                        if (!deviceIdToUse) {
                          console.warn("[Circle] Failed to get deviceId. Bypassing check for local debugging...");
                          // Bypass for debugging only: If deviceId fails, proceed with a mock or null if API allows?
                          // The API 'send-code' REQUIRES deviceId.
                          // However, maybe the SDK just needs more time?
                          // Let's try to RE-INIT the SDK?
                          setEmailError("Device Security Check Failed. Please refresh the page and try again.");
                          return;
                        }

                        console.log(
                          "[Circle] Send OTP using deviceId:",
                          deviceIdToUse
                        );

                        const res = await fetch("/api/auth/send-code", {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                          },
                          body: JSON.stringify({
                            email: emailInput,
                            deviceId: deviceIdToUse,
                          }),
                        });

                        const data = await res.json();
                        console.log("Send OTP response", {
                          status: res.status,
                          ok: res.ok,
                          data,
                        });

                        if (!res.ok) {
                          setEmailError(
                            data.error || "Failed to request OTP"
                          );
                          if (data && data.details) {
                            const raw = JSON.stringify(data.details);
                            const snippet =
                              raw.length > 300
                                ? `${raw.slice(0, 300)}...`
                                : raw;
                            setEmailErrorDetails(snippet);
                          } else {
                            setEmailErrorDetails("");
                          }
                          setEmailStatus("");
                          console.error("Send OTP failed", {
                            status: res.status,
                            data,
                          });
                          return;
                        }

                        if (typeof window !== "undefined") {
                          window.localStorage.setItem(
                            "circle_user_email",
                            emailInput
                          );
                        }

                        setCircleDeviceToken(data.deviceToken);
                        setCircleDeviceEncryptionKey(
                          data.deviceEncryptionKey
                        );
                        setCircleOtpToken(data.otpToken);

                        if (circleSdkRef.current) {
                          circleSdkRef.current.updateConfigs({
                            appSettings: { appId: CIRCLE_APP_ID },
                            loginConfigs: {
                              deviceToken: data.deviceToken,
                              deviceEncryptionKey: data.deviceEncryptionKey,
                              otpToken: data.otpToken,
                              email: { email: emailInput },
                            },
                          });
                          console.log("[Circle] loginConfigs set after send-code");
                        }

                        setEmailErrorDetails("");
                        setEmailStatus(
                          "OTP sent. After receiving OTP, click Verify to open Circle’s verification window."
                        );
                        setEmailStep(2);
                      } catch (err) {
                        console.error("Send OTP request error", err);
                        setEmailError("Failed to request OTP");
                        setEmailStatus("");
                      } finally {
                        setEmailLoading(false);
                      }
                    }}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 999,
                      border: "none",
                      background: "linear-gradient(90deg,#00f0ff,#00ffb7)",
                      color: "#001018",
                      fontWeight: 700,
                      cursor: emailLoading || !sdkReady ? "not-allowed" : "pointer",
                      opacity: emailLoading || !sdkReady ? 0.5 : 1,
                    }}
                  >
                    {emailLoading ? "Sending..." : "Send OTP"}
                  </button>
                </div>
              )}

              {emailStep === 2 && (
                <div>
                  <p
                    style={{
                      fontSize: "0.9rem",
                      marginBottom: 12,
                      color: "#e4f5ff",
                    }}
                  >
                    After receiving OTP, click Verify to open Circle’s verification window.
                  </p>
                  <button
                    disabled={
                      !circleDeviceToken ||
                      !circleDeviceEncryptionKey ||
                      !circleOtpToken ||
                      !sdkReady ||
                      emailLoading
                    }
                    onClick={async () => {
                      if (!circleSdkRef.current) {
                        setEmailError("Email login not ready");
                        return;
                      }
                      if (
                        !circleDeviceToken ||
                        !circleDeviceEncryptionKey ||
                        !circleOtpToken
                      ) {
                        setEmailError("Missing OTP session data");
                        return;
                      }

                      setEmailError("");
                      setEmailStatus("Opening Circle verification window...");
                      setEmailLoading(true);

                      try {
                        const sdk = circleSdkRef.current;
                        if (typeof sdk.verifyOtp === "function") {
                          console.log("Calling sdk.verifyOtp() for email OTP flow");
                          sdk.verifyOtp();
                        } else if (typeof sdk.emailLogin === "function") {
                          console.log(
                            "sdk.verifyOtp() not found, falling back to sdk.emailLogin()"
                          );
                          sdk.emailLogin();
                        } else {
                          console.warn(
                            "No Circle email verification method found on SDK"
                          );
                          setEmailError(
                            "Circle SDK does not expose an email verification method."
                          );
                          setEmailStatus("");
                          setEmailLoading(false);
                        }
                      } catch (e) {
                        console.error(
                          "Circle OTP verification trigger failed",
                          e
                        );
                        setEmailError(
                          "Failed to start Circle OTP verification. Check console for details."
                        );
                        setEmailStatus("");
                        setEmailLoading(false);
                      }
                    }}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 999,
                      border: "none",
                      background: "linear-gradient(90deg,#00f0ff,#00ffb7)",
                      color: "#001018",
                      fontWeight: 700,
                      cursor:
                        !circleDeviceToken ||
                        !circleDeviceEncryptionKey ||
                        !circleOtpToken ||
                        !sdkReady ||
                        emailLoading
                          ? "default"
                          : "pointer",
                      opacity:
                        !circleDeviceToken ||
                        !circleDeviceEncryptionKey ||
                        !circleOtpToken ||
                        !sdkReady ||
                        emailLoading
                          ? 0.7
                          : 1,
                    }}
                  >
                    {emailLoading ? "Please wait..." : "Verify in Circle Window"}
                  </button>
                </div>
              )}

              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  justifyContent: "flex-end",
                }}
              >
                <button
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      window.localStorage.removeItem("circle_device_id");
                      window.localStorage.removeItem("deviceId");
                      window.localStorage.removeItem("circle_user_email");
                      window.localStorage.removeItem("circle_user_token");
                      window.localStorage.removeItem("circle_encryption_key");
                      window.localStorage.removeItem("circle_device_token");
                      window.localStorage.removeItem(
                        "circle_device_encryption_key"
                      );
                      window.localStorage.removeItem("circle_otp_token");
                      window.localStorage.removeItem("circle_app_id");
                    }
                    setCircleDeviceId("");
                    setCircleDeviceToken("");
                    setCircleDeviceEncryptionKey("");
                    setCircleOtpToken("");
                    setEmailInput("");
                    setEmailStatus("");
                    setEmailError("");
                    if (typeof window !== "undefined") {
                      window.location.reload();
                    }
                  }}
                  style={{
                    background: "transparent",
                    border: "1px solid rgba(0,255,255,0.4)",
                    borderRadius: 999,
                    padding: "6px 12px",
                    fontSize: "0.8rem",
                    color: "#9bf5ff",
                    cursor: "pointer",
                  }}
                >
                  Reset email login
                </button>
              </div>

              {(emailStatus || emailError || emailErrorDetails) && (
                <div style={{ marginTop: 12, fontSize: "0.85rem" }}>
                  {emailStatus && (
                    <div style={{ color: "#9bf5ff" }}>{emailStatus}</div>
                  )}
                  {emailError && (
                    <div style={{ color: "#ff8080" }}>{emailError}</div>
                  )}
                  {emailErrorDetails && (
                    <pre
                      style={{
                        marginTop: 6,
                        color: "#ffb3b3",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {emailErrorDetails}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <main className="main">
          <section className="topCards hybrid-grid">
            <div className="card controls neon-card swapCardCentered">
              {activeTab === "profile" && (
                <div style={{ textAlign: "center", padding: "40px 20px" }}>
                  <h2>Profile</h2>

                  {!(address || authMode === "email") ? (
                    <div
                      className="neonPlaceholder"
                      style={{
                        marginTop: 40,
                        padding: "28px 20px",
                        borderRadius: 12,
                        border: "1px solid rgba(0,255,255,0.35)",
                        background: "rgba(0,0,0,0.25)",
                        boxShadow: "0 10px 30px rgba(0,255,255,0.12)",
                        maxWidth: 420,
                        marginLeft: "auto",
                        marginRight: "auto",
                        textAlign: "center",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "1.05em",
                          fontWeight: 700,
                          color: "#cfffff",
                          letterSpacing: "0.5px",
                          marginBottom: 20,
                        }}
                      >
                        CONNECT WALLET or LINK YOUR EMAIL to continue
                      </div>
                      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button
                          onClick={connectWallet}
                          style={{
                            padding: "10px 20px",
                            borderRadius: 999,
                            border: "none",
                            background: "linear-gradient(90deg,#00f0ff,#00ffb7)",
                            color: "#001018",
                            fontWeight: 700,
                            cursor: "pointer",
                            boxShadow: "0 0 18px rgba(0,255,255,0.6), 0 0 40px rgba(0,255,183,0.4)",
                          }}
                        >
                          Connect Wallet
                        </button>
                        <button
                          onClick={connectGmail}
                          style={{
                            padding: "10px 20px",
                            borderRadius: 999,
                            border: "1px solid rgba(0,255,255,0.5)",
                            background: "rgba(0, 20, 40, 0.6)",
                            color: "#00f0ff",
                            fontWeight: 700,
                            cursor: "pointer",
                            boxShadow: "0 0 15px rgba(0,255,255,0.2)",
                          }}
                        >
                          Connect via Gmail
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Profile Card (Identity & Stats) */}
                      {(address || authMode === "email") && (
                        <div
                          className="neon-card"
                          style={{
                            padding: 20,
                            marginBottom: 20,
                            textAlign: "left",
                          }}
                        >
                          {/* Top Section: Identity */}
                          {profileStats ? (
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "flex-start",
                                marginBottom: 25,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  gap: 15,
                                  alignItems: "center",
                                }}
                              >
                                {/* Avatar */}
                                <div
                                  onClick={
                                    isEditingProfile
                                      ? () => fileInputRef.current?.click()
                                      : undefined
                                  }
                                  style={{
                                    width: 64,
                                    height: 64,
                                    borderRadius: "50%",
                                    background:
                                      isEditingProfile && editForm.avatar
                                        ? `url(${editForm.avatar}) center/cover`
                                        : profileStats.avatar
                                        ? `url(${profileStats.avatar}) center/cover`
                                        : "linear-gradient(135deg, #0096ff, #00ffff)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    border: "2px solid rgba(255,255,255,0.2)",
                                    boxShadow: "0 4px 15px rgba(0,255,255,0.2)",
                                    overflow: "hidden",
                                    position: "relative",
                                    cursor: isEditingProfile
                                      ? "pointer"
                                      : "default",
                                  }}
                                >
                                  <input
                                    type="file"
                                    hidden
                                    ref={fileInputRef}
                                    accept="image/*"
                                    onChange={handleFileChange}
                                  />
                                  {isEditingProfile && (
                                    <div
                                      style={{
                                        position: "absolute",
                                        inset: 0,
                                        background: "rgba(0,0,0,0.4)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                    >
                                      <span style={{ fontSize: 20 }}>📷</span>
                                    </div>
                                  )}
                                  {!profileStats.avatar &&
                                    !editForm.avatar &&
                                    !isEditingProfile && (
                                      <span style={{ fontSize: 28 }}>👤</span>
                                    )}
                                </div>

                                <div>
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 10,
                                    }}
                                  >
                                    {isEditingProfile ? (
                                      <input
                                        className="swapInput"
                                        style={{
                                          padding: "5px 10px",
                                          fontSize: "1.1em",
                                          width: 160,
                                          marginBottom: 5,
                                        }}
                                        value={editForm.username}
                                        onChange={(e) =>
                                          setEditForm((p) => ({
                                            ...p,
                                            username: e.target.value,
                                          }))
                                        }
                                        placeholder="Username"
                                      />
                                    ) : (
                                      <h3
                                        style={{
                                          margin: 0,
                                          fontSize: "1.4em",
                                          letterSpacing: "0.5px",
                                        }}
                                      >
                                        {profileStats.username || "Anon User"}
                                      </h3>
                                    )}

                                    <button
                                      className={
                                        isEditingProfile
                                          ? "primaryBtn"
                                          : "secondaryBtn"
                                      }
                                      style={{
                                        padding: "4px 10px",
                                        fontSize: "0.75em",
                                        minWidth: 50,
                                        height: 26,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        borderRadius: 6,
                                      }}
                                      onClick={
                                        isEditingProfile
                                          ? saveProfile
                                          : startEditing
                                      }
                                    >
                                      {isEditingProfile ? "Save" : "Edit"}
                                    </button>
                                  </div>

                                  <div
                                    className="muted"
                                    style={{
                                      fontSize: "0.85em",
                                      marginTop: 4,
                                      fontFamily: "monospace",
                                      background: "rgba(255,255,255,0.05)",
                                      padding: "2px 6px",
                                      borderRadius: 4,
                                      display: "inline-block",
                                    }}
                                  >
                                    {shortAddr(address)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div
                              style={{
                                marginBottom: 25,
                                textAlign: "center",
                                padding: 20,
                                background: "rgba(255,255,255,0.02)",
                                borderRadius: 12,
                              }}
                            >
                              <div className="muted">Loading Profile...</div>
                            </div>
                          )}

                          {/* Stats Section */}
                          {profileStats && (
                            <div
                              className="profileStatsGrid"
                              style={{
                                marginBottom: 25,
                                background: "rgba(0,0,0,0.2)",
                                padding: 24,
                                borderRadius: 12,
                                border: "1px solid rgba(255,255,255,0.05)",
                              }}
                            >
                              <div style={{ textAlign: "center" }}>
                                <div
                                  className="muted"
                                  style={{
                                    fontSize: "0.75em",
                                    textTransform: "uppercase",
                                    marginBottom: 6,
                                  }}
                                >
                                  Total Swap Volume
                                </div>
                                <div
                                  style={{
                                    fontSize: "1.1em",
                                    fontWeight: "bold",
                                    color: "gold",
                                  }}
                                >
                                  $
                                  {Number(
                                    profileStats.swapVolume || 0
                                  ).toLocaleString()}
                                </div>
                              </div>
                              <div style={{ textAlign: "center" }}>

                                <div
                                  className="muted"
                                  style={{
                                    fontSize: "0.75em",
                                    textTransform: "uppercase",
                                    marginBottom: 6,
                                  }}
                                >
                                  Total Swap Count
                                </div>
                                <div
                                  style={{
                                    fontSize: "1.1em",
                                    fontWeight: "bold",
                                  }}
                                >
                                  {profileStats.swapCount || 0}
                                </div>
                              </div>
                              <div style={{ textAlign: "center" }}>
                                <div
                                  className="muted"
                                  style={{
                                    fontSize: "0.75em",
                                    textTransform: "uppercase",
                                    marginBottom: 6,
                                  }}
                                >
                                  Total LP Provided
                                </div>
                                <div
                                  style={{
                                    fontSize: "1.1em",
                                    fontWeight: "bold",
                                    color: "cyan",
                                  }}
                                >
                                  $
                                  {Number(
                                    profileStats.lpProvided || 0
                                  ).toLocaleString()}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Badges Section */}
                          {profileStats && (
                            <div style={{ marginBottom: 25 }}>
                              <h4
                                style={{
                                  margin: "0 0 12px 0",
                                  fontSize: "0.85em",
                                  textTransform: "uppercase",
                                  opacity: 0.7,
                                  letterSpacing: "1px",
                                }}
                              >
                                Badges
                              </h4>
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "140px",
                                  justifyContent: "start",
                                  gap: 12,
                                }}
                              >
                                {/* Early Swaparcer Badge */}
                                {(() => {
                                  const unlocked = badgeState.earlySwaparcer;

                                  return (
                                    <div
                                      className="badgeTile"
                                      style={{
                                        width: 140,
                                        height: 160,
                                        borderRadius: 12,
                                        background: unlocked
                                          ? "rgba(0, 255, 255, 0.15)"
                                          : "rgba(255, 255, 255, 0.03)",
                                        border: `1px solid ${
                                          unlocked
                                            ? "rgba(0, 255, 255, 0.5)"
                                            : "rgba(255, 255, 255, 0.05)"
                                        }`,
                                        opacity: unlocked ? 1 : 0.4,
                                        filter: unlocked ? "none" : "grayscale(100%)",
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        overflow: "hidden",
                                        gap: 6
                                      }}
                                    >
                                      <img
                                        src="/badges/early-swaparcer.png"
                                        alt="Early Swaparcer"
                                        style={{
                                          width: "100%",
                                          height: 112,
                                          objectFit: "cover",
                                        }}
                                      />
                                      <div
                                        className="badgeLabel"
                                        style={{
                                          fontSize: "0.75em",
                                          fontWeight: 700,
                                          color: unlocked ? "cyan" : "inherit",
                                          textTransform: "uppercase"
                                        }}
                                      >
                                        Early Swaparcer
                                      </div>
                                    </div>
                                  );
                                })()}

                                
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Wallet Portfolio Section - Independent Card */}
                      {address && (
                        <div
                          className="neon-card"
                          style={{
                            padding: 20,
                            marginBottom: 20,
                            textAlign: "left",
                          }}
                        >
                          <h3 style={{ marginTop: 0, marginBottom: 20 }}>
                            Wallet Portfolio
                          </h3>

                          {/* Wallet Address */}
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 15,
                              fontSize: "0.9em",
                              background: "rgba(255,255,255,0.03)",
                              padding: "8px 12px",
                              borderRadius: 8,
                            }}
                          >
                            <span className="muted">Address</span>
                            <span
                              style={{
                                fontFamily: "monospace",
                                fontSize: "0.85em",
                              }}
                            >
                              {address}
                            </span>
                          </div>

                          {/* Total Value */}
                          <div
                            style={{ marginBottom: 20, textAlign: "center" }}
                          >
                            <div
                              className="muted"
                              style={{ fontSize: "0.8em", marginBottom: 5 }}
                            >
                              Total Value
                            </div>
                            <div
                              style={{
                                fontSize: "1.6em",
                                fontWeight: "bold",
                                color: "#4caf50",
                              }}
                            >
                              $
                              {portfolioValue.toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                              })}
                            </div>
                          </div>

                          {/* Token Balances */}
                          <div style={{ marginBottom: 15 }}>
                            <div
                              className="muted"
                              style={{
                                fontSize: "0.8em",
                                marginBottom: 8,
                                paddingLeft: 5,
                              }}
                            >
                              Tokens
                            </div>
                            <div
                              style={{
                                background: "rgba(0,0,0,0.3)",
                                borderRadius: 8,
                                overflow: "hidden",
                              }}
                            >
                              {["USDC", "EURC", "SWPRC"].map((sym) => {
                                const bal = Number(balances[sym] || 0);
                                const val = bal * Number(tokenPrices[sym] || 0);
                                return (
                                  <div
                                    key={sym}
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      padding: "10px 12px",
                                      borderBottom:
                                        "1px solid rgba(255,255,255,0.05)",
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                      }}
                                    >
                                      <img
                                        src={TOKEN_LOGOS[sym]}
                                        style={{
                                          width: 20,
                                          height: 20,
                                          borderRadius: "50%",
                                        }}
                                        alt={sym}
                                      />
                                      <span>{sym}</span>
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                      <div>{bal.toFixed(4)}</div>
                                      <div
                                        className="muted"
                                        style={{ fontSize: "0.8em" }}
                                      >
                                        ${val.toFixed(2)}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* LP Positions */}
                          {Object.keys(lpBalances).some(
                            (k) => lpBalances[k] > 0
                          ) && (
                            <div>
                              <div
                                className="muted"
                                style={{
                                  fontSize: "0.8em",
                                  marginBottom: 8,
                                  paddingLeft: 5,
                                }}
                              >
                                LP Positions
                              </div>
                              <div
                                style={{
                                  background: "rgba(0,0,0,0.3)",
                                  borderRadius: 8,
                                  overflow: "hidden",
                                }}
                              >
                                {POOLS.map((p) => {
                                  const bal = lpBalances[p.id];
                                  if (!bal || bal <= 0) return null;
                                  const amounts = lpTokenAmounts[p.id] || {};
                                  const val = Object.entries(amounts).reduce(
                                    (sum, [sym, amt]) =>
                                      sum + amt * Number(tokenPrices[sym] || 0),
                                    0
                                  );
                                  return (
                                    <div
                                      key={p.id}
                                      style={{
                                        padding: "10px 12px",
                                        borderBottom:
                                          "1px solid rgba(255,255,255,0.05)",
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          justifyContent: "space-between",
                                          marginBottom: 5,
                                        }}
                                      >
                                        <span>{p.name}</span>
                                        <span>{bal.toFixed(4)} LP</span>
                                      </div>
                                      <div
                                        style={{
                                          display: "flex",
                                          justifyContent: "space-between",
                                          fontSize: "0.8em",
                                        }}
                                      >
                                        <span className="muted">
                                          {Object.entries(amounts)
                                            .map(
                                              ([sym, amt]) =>
                                                `${amt.toFixed(2)} ${sym}`
                                            )
                                            .join(" + ")}
                                        </span>
                                        <span className="muted">
                                          ${val.toFixed(2)}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Circle Wallet Placeholder */}
                      {authMode === "email" && (
                        <div
                          className="neon-card"
                          style={{
                            textAlign: "left",
                            marginBottom: 20,
                            padding: 20,
                          }}
                        >
                          <h3 style={{ marginTop: 0 }}>Circle Wallet</h3>
                          {circleWalletReady && circleWallet ? (
                            <>
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  marginBottom: 10,
                                  fontSize: "0.9em",
                                }}
                              >
                                <span className="muted">Address</span>
                                <span
                                  style={{
                                    fontFamily: "monospace",
                                    fontSize: "0.85em",
                                  }}
                                >
                                  {circleWallet.address}
                                </span>
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  marginBottom: 6,
                                  fontSize: "0.9em",
                                }}
                              >
                                <span className="muted">Blockchain</span>
                                <span>{circleWallet.blockchain}</span>
                              </div>
                              <div className="muted" style={{ fontSize: "0.8em" }}>
                                Wallet ID: {circleWallet.walletId}
                              </div>
                            </>
                          ) : (
                            <p style={{ color: "cyan", fontWeight: "bold" }}>
                              Provisioning Circle Smart Wallet...
                            </p>
                          )}
                        </div>
                      )}

                      <p className="muted" style={{ marginTop: 20 }}>
                        {authMode === "wallet"
                          ? "Profile connected via Wallet"
                          : "Email login coming next – profile setup required"}
                      </p>
                    </>
                  )}
                </div>
              )}
              {activeTab === "swap" && (
                <>
                  <div className="swapCardHeader">
                    <h2 className="swapTitle">Swap</h2>
                    <button
                      type="button"
                      className="slippageSettingsBtn"
                      onClick={() => setShowSlippagePanel((v) => !v)}
                      aria-label="Slippage settings"
                    >
                      <span className="slippageSettingsIcon">⚙</span>
                      <span className="slippageSettingsValue">
                        {Number(swapSummary.slippageRaw || slippageTolerance).toFixed(1)}%
                      </span>
                    </button>
                  </div>

                  <div className="swapRowClean">
                    <div className="swapBox">
                      <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 8 }}>
                        <div className="swapLabel" style={{ marginBottom: 0 }}>Sell</div>
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
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
                        <TokenSelect
                          tokens={tokens}
                          value={swapFrom}
                          onChange={setSwapFrom}
                        />
                        {balances[swapFrom] && balances[swapFrom] !== "n/a" && (
                          <div className="tokenBalanceHint" style={{ marginTop: 0, fontSize: 13 }}>
                            {balances[swapFrom]}
                          </div>
                        )}
                      </div>
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
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <polyline points="19 12 12 19 5 12"></polyline>
                      </svg>
                    </button>
                  </div>

                  <div className="swapRowClean">
                    <div className="swapBox">
                      <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 8 }}>
                        <div className="swapLabel" style={{ marginBottom: 0 }}>Buy</div>
                        <div className="swapInput readOnly" style={{ fontSize: estimatedTo ? 36 : 28 }}>
                          {estimatedTo || (quote ? "…" : "0.00")}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
                        <TokenSelect
                          tokens={tokens}
                          value={swapTo}
                          onChange={setSwapTo}
                        />
                        {balances[swapTo] && balances[swapTo] !== "n/a" && (
                          <div className="tokenBalanceHint" style={{ marginTop: 0, fontSize: 13 }}>
                            {balances[swapTo]}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Slippage settings panel (toggles from gear icon) */}
                  {showSlippagePanel && (
                    <div className="slippagePanel">
                      <div className="slippagePanelHeader">
                        <span className="muted">Slippage tolerance</span>
                        <span className="slippageCurrent">
                          {Number(slippageTolerance).toFixed(1)}%
                        </span>
                      </div>
                      <div className="slippagePresetRow">
                        {[0.1, 0.5, 1, 2, 5].map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={
                              Number(slippageTolerance) === p
                                ? "slippageChip active"
                                : "slippageChip"
                            }
                            onClick={() => setSlippageTolerance(p)}
                          >
                            {p}%
                          </button>
                        ))}
                      </div>
                      <div className="slippageInputRow">
                        <input
                          type="number"
                          min="0.1"
                          max="100"
                          step="0.1"
                          value={slippageTolerance}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!Number.isNaN(v)) {
                              setSlippageTolerance(Math.max(0.1, Math.min(100, v)));
                            }
                          }}
                          className="slippageInput"
                        />
                        <span className="muted">%</span>
                      </div>
                      {Number(slippageTolerance) > 20 ? (
                        <p className="slippageWarning danger">
                          Very high slippage (&gt;20%). You may receive much less than expected.
                        </p>
                      ) : Number(slippageTolerance) > 5 ? (
                        <p className="slippageWarning caution">
                          High slippage (&gt;5%). This trade may be vulnerable to price swings.
                        </p>
                      ) : null}
                    </div>
                  )}

                  {/* Swap summary: expected output, minimum received, slippage, price impact */}
                  {expectedOutputNum != null && swapSummary.minimumReceivedNum != null && (
                    <div style={{ marginTop: 12, padding: "10px 12px", background: "rgba(0,0,0,0.25)", borderRadius: 8, fontSize: 13 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span className="muted">Expected Output</span>
                        <span>{expectedOutputNum >= 1000 ? expectedOutputNum.toLocaleString(undefined, { maximumFractionDigits: 2 }) : expectedOutputNum.toFixed(6)} {swapTo}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span className="muted">Minimum Received</span>
                        <span>{swapSummary.minimumReceivedNum >= 1000 ? swapSummary.minimumReceivedNum.toLocaleString(undefined, { maximumFractionDigits: 2 }) : swapSummary.minimumReceivedNum.toFixed(6)} {swapTo}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span className="muted">Slippage</span>
                        <span>{swapSummary.slippagePct}%</span>
                      </div>
                      {swapSummary.priceImpactPercent != null && (
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span className="muted">Price Impact</span>
                          <span>{swapSummary.priceImpactPercent.toFixed(2)}%</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Warnings */}
                  {swapSummary.tradeSizeTooLarge && (
                    <p className="quote" style={{ marginTop: 10, color: "#f59e0b" }}>
                      Trade size is too large for current liquidity.
                    </p>
                  )}
                  {swapSummary.isHighImpact && !swapSummary.isExtremeImpact && (
                    <p className="quote" style={{ marginTop: 10, color: "#f59e0b" }}>
                      ⚠️ This trade has high price impact due to low liquidity.
                    </p>
                  )}
                  {swapSummary.isExtremeImpact && (
                    <label style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "rgba(255,255,255,0.9)", fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={!!highImpactConfirmed}
                        onChange={(e) => setHighImpactConfirmed(e.target.checked)}
                      />
                      <span>I understand this trade has very high price impact (&gt;25%) and accept the risk.</span>
                    </label>
                  )}

                  <div style={{ marginTop: 12 }}>
                    <button
                      className="primaryBtn neon-btn"
                      onClick={performSwap}
                      disabled={swapSummary.tradeSizeTooLarge || (swapSummary.isExtremeImpact && !highImpactConfirmed)}
                    >
                      Swap
                    </button>
                  </div>

                  {quote && (
                    <p className="quote">
                      <strong>Quote:</strong> {quote}
                    </p>
                  )}

                  <div
                    style={{
                      marginTop: 24,
                      display: "flex",
                      justifyContent: "center",
                    }}
                  >
                    <button
                      className="secondaryBtn"
                      style={{ fontSize: 13, padding: "8px 16px" }}
                      onClick={() => setActiveTab("history")}
                    >
                      View Swap History
                    </button>
                  </div>
                </>
              )}
              {activeTab === "history" && (
                <div className="historyBox">
                  <button
                    style={{
                      background: "none",
                      border: "none",
                      color: "rgba(255, 255, 255, 0.6)",
                      cursor: "pointer",
                      marginBottom: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 14,
                      padding: 0,
                    }}
                    onClick={() => setActiveTab("swap")}
                  >
                    ◀ Back
                  </button>
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

                        {!getActiveWalletAddress() ? (
                          <p className="muted">
                            Connect wallet to view positions.
                          </p>
                        ) : lpLoading ? (
                          <p className="muted">Loading your positions…</p>
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
                            <div key={p.id} className="positionCard card" style={{ padding: 24 }}>
                              <div className="poolHeader">
                                <div className="poolTokens">
                                  {p.tokens.map((t, i) => (
                                    <span key={`${p.id}-${t}-${i}`} className="token-badge">
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
                                  MY LIQUIDITY
                                </div>

                                {lpTokenAmounts[p.id] &&
                                Object.keys(lpTokenAmounts[p.id]).length > 0 ? (
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
                        {/* High-end TVL Dashboard */}
                        <div className="profileStatsGrid" style={{ marginBottom: 32 }}>
                          <div className="card" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                            <div className="muted" style={{ fontSize: 13, marginBottom: 10, fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase" }}>Total TVL</div>
                            <strong style={{ fontSize: 32, color: "white", lineHeight: 1.1 }}>
                              ${Number(totalPoolTVL()).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </strong>
                          </div>
                          <div className="card" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                            <div className="muted" style={{ fontSize: 13, marginBottom: 10, fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase" }}>Active Pools</div>
                            <strong style={{ fontSize: 32, color: "white", lineHeight: 1.1 }}>{POOLS.length}</strong>
                          </div>
                          <div className="card" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center" }}>
                            <div className="muted" style={{ fontSize: 13, marginBottom: 10, fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase" }}>My LP Value</div>
                            <strong style={{ fontSize: 32, color: "#4caf50", lineHeight: 1.1 }}>
                              ${lpBalances && Object.keys(lpBalances).length > 0 ? Object.keys(lpBalances).reduce((acc, poolId) => acc + (lpTokenAmounts[poolId] ? Object.entries(lpTokenAmounts[poolId]).reduce((sum, [sym, amt]) => sum + (amt * Number(tokenPrices[sym] || 0)), 0) : 0), 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "0.00"}
                            </strong>
                          </div>
                        </div>

                        <div className="poolsGrid">
                          {POOLS.map((p) => {
                            const tvl = poolBalances[p.id] || 0;

                            return (
                              <div key={p.id} className="poolCard card">
                                <div className="poolHeader" style={{ paddingBottom: 16, borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: 16 }}>
                                  <div className="poolTokens">
                                    {p.tokens.map((t, i) => (
                                      <span key={i} className="token-badge" style={{ marginLeft: i > 0 ? -10 : 0, WebkitMaskImage: i > 0 ? "radial-gradient(circle at -4px center, transparent 12px, black 13px)" : "none" }}>
                                        <img
                                          src={TOKEN_LOGOS[t]}
                                          alt={t}
                                          style={{
                                            width: 32,
                                            height: 32,
                                            borderRadius: "50%",
                                          }}
                                        />
                                      </span>
                                    ))}
                                  </div>
                                  <div className="poolName" style={{ fontSize: 18 }}>{p.name}</div>
                                </div>

                                <div className="poolLiquidity" style={{ marginBottom: 16 }}>
                                  <div className="liquidityTitle" style={{ fontSize: 12, color: "#8c9bb5", marginBottom: 8 }}>
                                    TOTAL LIQUIDITY
                                  </div>

                                  {poolTokenBalances[p.id] ? (
                                    Object.entries(poolTokenBalances[p.id]).map(
                                      ([sym, amt]) => (
                                        <div key={sym} className="liquidityRow" style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                          <span style={{ fontSize: 14 }}>{sym}</span>
                                          <strong style={{ fontSize: 14, color: "#eef8ff" }}>{amt >= 1000 ? amt.toLocaleString(undefined, { maximumFractionDigits: 2 }) : amt.toFixed(2)}</strong>
                                        </div>
                                      )
                                    )
                                  ) : (
                                    <span className="muted">—</span>
                                  )}
                                </div>

                                <div className="poolStat" style={{ padding: "12px 0", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                                  <span style={{ color: "#8c9bb5" }}>Fee Tier</span>
                                  <strong style={{ color: "#eef8ff" }}>0.30%</strong>
                                </div>

                                <button
                                  className="primaryBtn"
                                  style={{ marginTop: 2 }}
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
              {activeTab === "leaderboard" && (
                <div className="leaderboardContainer" style={{ width: "100%" }}>
                  <div className="historyToggleRow">
                    <button
                      className={`historyToggleBtn ${
                        leaderboardTab === "swaps" ? "active" : ""
                      }`}
                      onClick={() => setLeaderboardTab("swaps")}
                    >
                      TOP TRADERS
                    </button>
                    <button
                      className={`historyToggleBtn ${
                        leaderboardTab === "lp" ? "active" : ""
                      }`}
                      onClick={() => setLeaderboardTab("lp")}
                    >
                      TOP LP PROVIDERS
                    </button>
                  </div>

                  <div className="neon-card" style={{ marginTop: 20 }}>
                    {leaderboardTab === "swaps" && (
                      <ul className="historyList">
                        {leaderboard.topSwapVolume.length === 0 ? (
                          <p className="muted">No data yet</p>
                        ) : (
                          leaderboard.topSwapVolume.map((u, i) => (
                            <li key={i} className="historyItem">
                              <div className="historyLeft">
                                <strong>
                                  #{i + 1} {u.username || shortAddr(u.userId)}
                                </strong>
                              </div>
                              <div className="historyRight">
                                Vol: $
                                {Number(u.swapVolume).toLocaleString(
                                  undefined,
                                  { maximumFractionDigits: 2 }
                                )}{" "}
                                <br />
                                <span
                                  className="muted"
                                  style={{ fontSize: 12 }}
                                >
                                  {u.swapCount} Swaps
                                </span>
                              </div>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                    {leaderboardTab === "lp" && (
                      <ul className="historyList">
                        {leaderboard.topLPProvided.length === 0 ? (
                          <p className="muted">No data yet</p>
                        ) : (
                          leaderboard.topLPProvided.map((u, i) => (
                            <li key={i} className="historyItem">
                              <div className="historyLeft">
                                <strong>
                                  #{i + 1} {u.username || shortAddr(u.userId)}
                                </strong>
                              </div>
                              <div className="historyRight">
                                LP: $
                                {Number(u.lpProvided).toLocaleString(
                                  undefined,
                                  { maximumFractionDigits: 2 }
                                )}
                              </div>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                </div>
              )}
              {activeTab === "arcpay" && (
                <div
                  className="neon-card"
                  style={{
                    boxShadow: "0 0 20px rgba(0, 150, 255, 0.4)",
                    border: "1px solid rgba(0, 150, 255, 0.6)",
                    textAlign: "center",
                    padding: "60px 20px",
                  }}
                >
                  <h2 style={{ fontSize: 32, marginBottom: 16 }}>ARCPAY</h2>
                  <p
                    style={{
                      fontSize: 18,
                      letterSpacing: 4,
                      opacity: 0.8,
                    }}
                  >
                    Wallet Dashboard
                  </p>
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
                : txModal.status === "pending"
                  ? "Transaction Submitted"
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
                setActiveTab("profile");
                setMobileMenuOpen(false);
              }}
            >
              Profile
            </button>

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
                setActiveTab("pools");
                setMobileMenuOpen(false);
              }}
            >
              Pools
            </button>

            <button
              onClick={() => {
                setActiveTab("arcpay");
                setMobileMenuOpen(false);
              }}
            >
              ARCPAY
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
          <div className="txModal liquidityModal card" style={{ maxWidth: 460, padding: "24px 28px" }}>
            <h3 style={{ marginBottom: 24, fontSize: 22, fontWeight: 600 }}>Deposit Liquidity</h3>

            <div style={{ marginBottom: 24 }}>
              {(activePreset?.tokens || ["USDC", "EURC", "SWPRC"]).map((sym) => (
                <div key={sym} className="card" style={{ marginBottom: 12, padding: "16px 20px", background: "rgba(0,0,0,0.2)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <img src={TOKEN_LOGOS[sym]} alt={sym} style={{ width: 24, height: 24, borderRadius: "50%" }} />
                      <span style={{ fontSize: 18, fontWeight: 600 }}>{sym}</span>
                    </div>
                    <span className="muted" style={{ fontSize: 14 }}>
                      Balance: {balances[sym]}
                    </span>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <input
                      className="swapInput"
                      placeholder="0.00"
                      value={liqInputs[sym] || ""}
                      onChange={(e) => setLiqInputs((p) => ({ ...p, [sym]: e.target.value }))}
                      style={{ fontSize: 32, padding: 0, width: "70%" }}
                    />
                    <div className="muted" style={{ fontSize: 14, textAlign: "right", whiteSpace: "nowrap" }}>
                      ≈ ${liqInputs[sym] && prices[sym] ? (Number(liqInputs[sym]) * prices[sym]).toFixed(2) : "0.00"}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Price Ratio Info Block */}
            <div className="card" style={{ padding: "12px 16px", marginBottom: 24, background: "rgba(0,0,0,0.2)" }}>
               <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                 <span className="muted" style={{ fontSize: 13 }}>Current Pool Fee</span>
                 <strong style={{ fontSize: 14, color: "#00f0ff" }}>0.30%</strong>
               </div>
            </div>

            <div className="txActions">
              <button className="secondaryBtn" onClick={closeAddLiquidity}>
                Cancel
              </button>

              <button
                className="primaryBtn"
                onClick={handleAddLiquidity}
                disabled={liqLoading}
              >
                {liqLoading ? "Supplying..." : "Supply Liquidity"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRemoveLiquidity && (
        <div className="modalOverlay">
          <div className="txModal liquidityModal card" style={{ maxWidth: 460, padding: "24px 28px" }}>
            <h3 style={{ marginBottom: 24, fontSize: 22, fontWeight: 600 }}>Remove Liquidity</h3>

            <div className="card" style={{ padding: "16px 20px", marginBottom: 24, background: "rgba(0,0,0,0.2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <span className="muted" style={{ fontSize: 14 }}>Amount to Remove</span>
                <span className="muted" style={{ fontSize: 14 }}>
                  LP Balance: {activePreset && lpBalances[activePreset.id] != null ? lpBalances[activePreset.id].toFixed(6) : "—"}
                </span>
              </div>
              
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <input
                  className="swapInput"
                  placeholder="0.00"
                  value={removeLpAmount}
                  onChange={(e) => setRemoveLpAmount(e.target.value)}
                  style={{ fontSize: 32, padding: 0, width: "65%" }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                   <button 
                     className="secondaryBtn" 
                     style={{ padding: "4px 8px", fontSize: 12 }}
                     onClick={() => setRemoveLpAmount(activePreset && lpBalances[activePreset.id] != null ? (lpBalances[activePreset.id] * 0.5).toFixed(6) : "0")}
                   >
                     50%
                   </button>
                   <button 
                     className="secondaryBtn" 
                     style={{ padding: "4px 8px", fontSize: 12 }}
                     onClick={() => setRemoveLpAmount(activePreset && lpBalances[activePreset.id] != null ? lpBalances[activePreset.id].toFixed(6) : "0")}
                   >
                     Max
                   </button>
                </div>
              </div>
            </div>

            <div className="txActions">
              <button
                className="secondaryBtn"
                onClick={() => { setShowRemoveLiquidity(false); setRemoveLpAmount(""); }}
              >
                Cancel
              </button>

              <button
                className="primaryBtn"
                onClick={handleRemoveLiquidity}
                disabled={removeLoading || !removeLpAmount || Number(removeLpAmount) <= 0}
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
