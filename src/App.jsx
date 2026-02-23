import { useEffect, useState, useRef, useMemo } from "react";
import { ethers } from "ethers";
import logo from "./assets/swaparc-logo.png";
import usdcLogo from "./assets/usdc.jpg";
import eurcLogo from "./assets/eurc.jpg";
import swprcLogo from "./assets/swprc.jpg";
import "./App.css";
import { getPrices } from "./priceFetcher";

const ARC_CHAIN_ID_DEC = 5042002;
const ARC_CHAIN_ID_HEX = "0x4CEF52";
const CIRCLE_APP_ID = import.meta.env.VITE_CIRCLE_APP_ID || "";

console.log("Circle env VITE_CIRCLE_APP_ID", CIRCLE_APP_ID);

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
  const [authMode, setAuthMode] = useState("wallet");
  const [leaderboard, setLeaderboard] = useState({
    topSwapVolume: [],
    topSwapCount: [],
    topLPProvided: [],
  });
  const [showConnectMenu, setShowConnectMenu] = useState(false);
  const [gmailComingSoon, setGmailComingSoon] = useState(false);
  const [userEmail, setUserEmail] = useState(null);
  const [circleWallet, setCircleWallet] = useState(null);
  const [circleWalletReady, setCircleWalletReady] = useState(false);
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
  const [circleLogin, setCircleLogin] = useState(null);
  const [circleChallengeId, setCircleChallengeId] = useState(null);
  const userEmailRef = useRef(null);

  async function ensureCircleDeviceId() {
    if (typeof window === "undefined") return null;
    if (!circleSdkRef.current) {
      console.warn("[Circle] ensureCircleDeviceId: SDK not ready");
      return null;
    }

    try {
      const cached = window.localStorage.getItem("deviceId");

      if (cached) {
        console.log("[Circle] deviceId from storage:", cached);
        setCircleDeviceId(cached);
        return cached;
      }

      const id = await circleSdkRef.current.getDeviceId();
      console.log("[Circle] deviceId from sdk.getDeviceId()", id);

      setCircleDeviceId(id);
      window.localStorage.setItem("deviceId", id);
      return id;
    } catch (error) {
      console.warn("[Circle] getDeviceId failed:", error);
      setEmailError(
        "Failed to initialize device with Circle (deviceId). Enable third-party cookies or disable privacy extensions, then try Reset email login."
      );
      return null;
    }
  }

  // Fetch On-Chain Prices Once (Shared Source)
  useEffect(() => {
    userEmailRef.current = userEmail;
  }, [userEmail]);

  useEffect(() => {
    let mounted = true;
    async function fetchOnChainPrices() {
      if (!window.ethereum) return;
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
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
  }, []); // Run once on mount (and interval)

  // Portfolio Total Value Calculation (Memoized)
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
    const data = await getProfileData(addr);
    if (data) {
      setProfileStats(data);
      setUserId(data.userId);
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
  const circleSdkRef = useRef(null);

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
    if (activeTab === "profile") {
      (async () => {
        if (!address) return;

        if (window.ethereum) {
          const provider = new ethers.BrowserProvider(window.ethereum);
          try {
            // Run simultaneous fetches (Prices handled globally now)
            const [profData, balData, lpBalData, lpAmountsResult] =
              await Promise.all([
                getProfileData(address),
                getBalances(address, provider),
                getAllLPBalancesData(address, provider),
                getLpTokenAmountsData(address, provider),
              ]);

            // Handle LP backend update is now in a separate effect

            // Patch profile with latest LP if available and valid
            let finalProfile = profData;
            // We don't need to patch LP here imperatively as we rely on the calculated value
            // But for initial display, we might want to ensure consistency?
            // Actually, we should just set the fetched profile.
            // The derived values (LP, Portfolio) are calculated via useMemo/state.

            // Batch Updates
            if (finalProfile) {
              setProfileStats(finalProfile);
              setUserId(finalProfile.userId);
            }
            setBalances(balData || {});
            setLpBalances(lpBalData || {});
            setLpTokenAmounts(lpAmountsResult?.amounts || {});

            // Note: portfolioValue is updated via useEffect/useMemo dependent on balances/prices
          } catch (e) {
            console.error("Profile load error", e);
          }
        } else {
          fetchProfile();
        }
      })();
    }
  }, [activeTab, address]); // Removed swapHistory dependency as repair is separate

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
          userId: userId || address,
          swapCount: rebuiltCount,
          swapVolume: rebuiltVolume,
        }),
      }).catch(console.error);
    }
    */
  }, [swapHistory, tokenPrices, profileStats, userId, address]);
  

  useEffect(() => {
    if (address) {
      fetchProfile(address);
    } else {
      setProfileStats(null);
      setUserId(null);
    }
  }, [address]);

  useEffect(() => {
    if (!CIRCLE_APP_ID) {
      console.warn("Circle SDK init skipped: missing VITE_CIRCLE_APP_ID");
      return;
    }

    let cancelled = false;

    const initSdk = async () => {
      try {
        console.log("[Circle] init appId:", CIRCLE_APP_ID);

        const onLoginComplete = async (error, result) => {
          if (cancelled) return;

          if (error || !result) {
            const err = error || {};
            const message =
              err && err.message ? err.message : "Email authentication failed";
            setEmailError(message);
            setEmailStatus("");
            setCircleLogin(null);
            return;
          }

          const loginData = {
            userId: result.userId || null,
            userToken: result.userToken,
            encryptionKey: result.encryptionKey,
            refreshToken: result.refreshToken || null,
          };

          setCircleLogin(loginData);
          setEmailError("");

          const email = userEmailRef.current;

          if (!email) {
            setEmailStatus("Email verified.");
            return;
          }

          try {
            setEmailStatus("Email verified. Loading wallet...");

            if (typeof window !== "undefined") {
              window.localStorage.setItem("circle_user_email", email);
              window.localStorage.setItem(
                "circle_user_token",
                loginData.userToken
              );
              window.localStorage.setItem(
                "circle_encryption_key",
                loginData.encryptionKey
              );
            }

            let res = await fetch("/api/circle/user/get-or-create-wallet", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email,
                userToken: loginData.userToken,
              }),
            });

            let data = await res.json();

            if (res.status === 404) {
              await initializeAndCreateCircleWallet(loginData);

              res = await fetch("/api/circle/user/get-or-create-wallet", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  email,
                  userToken: loginData.userToken,
                }),
              });
              data = await res.json();
            }

            if (!res.ok) {
              setEmailError(
                data.error || data.message || "Failed to load Circle wallet"
              );
              setEmailStatus("");
              return;
            }

            setCircleWallet({
              walletId: data.walletId,
              address: data.address,
              blockchain: data.blockchain,
            });
            setCircleWalletReady(true);
            setAuthMode("email");
            setEmailStatus("Circle wallet ready");
            setShowEmailModal(false);
          } catch {
            setEmailError("Failed to load Circle wallet");
            setEmailStatus("");
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
        if (cancelled) return;
        setEmailError("Circle email connect is unavailable");
      }
    };

    initSdk();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sdkReady || !circleSdkRef.current) return;
    ensureCircleDeviceId();
  }, [sdkReady]);

  useEffect(() => {
    console.log("Circle debug state", {
      appId: CIRCLE_APP_ID,
      sdkReady,
      circleDeviceId,
    });
  }, [sdkReady, circleDeviceId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedEmail = window.localStorage.getItem("circle_user_email");
    const storedToken = window.localStorage.getItem("circle_user_token");
    if (!storedEmail || !storedToken) return;

    let cancelled = false;

    (async () => {
      try {
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
          return;
        }

        if (cancelled) return;

        setUserEmail(storedEmail);
        setCircleWallet({
          walletId: data.walletId,
          address: data.address,
          blockchain: data.blockchain,
        });
        setCircleWalletReady(true);
        setAuthMode("email");
      } catch {
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function getAllLPBalancesData(user, provider) {
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
    return balances;
  }

  async function fetchAllLPBalances(user, provider) {
    const balances = await getAllLPBalancesData(user, provider);
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

          // Calculate USD value for this portion
          const price = await getOnchainPriceInUSDC(provider, sym);
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
  }

  async function getBalances(userAddress, provider) {
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

      // Update progression
      try {
        const price = tokenPrices[swapFrom] || 1;
        const usdValue = Number(swapAmount) * Number(price);
        await fetch("/api/profile/addSwap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: await signer.getAddress(),
            amount: usdValue,
          }),
        });
        const userAddr = await signer.getAddress();
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
      setEmailError("");

      const res = await fetch("/api/circle/user/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userToken: loginData.userToken }),
      });
      const data = await res.json();

      if (!res.ok) {
        setEmailError(data.error || "Failed to initialize Circle user");
        setEmailStatus("");
        return;
      }

      const challengeId = data.challengeId;
      if (!challengeId) {
        setEmailError("Missing challengeId from Circle");
        setEmailStatus("");
        return;
      }

      setCircleChallengeId(challengeId);
      circleSdkRef.current.setAuthentication({
        userToken: loginData.userToken,
        encryptionKey: loginData.encryptionKey,
      });

      setEmailStatus("Creating Circle wallet...");

      circleSdkRef.current.execute(challengeId, async (error) => {
        if (error) {
          const message =
            error && error.message
              ? error.message
              : "Failed to execute Circle challenge";
          setEmailError(message);
          setEmailStatus("");
          return;
        }

        setCircleChallengeId(null);
        setEmailStatus("Circle wallet created. Loading details...");

        await new Promise((resolve) => setTimeout(resolve, 2000));
        await loadCircleWallet(loginData.userToken);
      });
    } catch (e) {
      setEmailError("Circle email login failed");
      setEmailStatus("");
    }
  }

  function connectGmail() {
    setActiveTab("profile");
    setShowEmailModal(false);
    setEmailStep(1);
    setEmailStatus("");
    setEmailError("");
    setGmailComingSoon(true);
  }

  function getActiveWalletAddress() {
    if (
      authMode === "email" &&
      circleWallet &&
      circleWallet.address
    ) {
      return circleWallet.address;
    }
    if (address) return address;
    return null;
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
                      onClick={() => {
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

            {address ? (
              <button className="walletPill" onClick={disconnectWallet}>
                Arc Testnet · {shortAddr(address)}
              </button>
            ) : null}

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
                          setEmailStatus("");
                          setEmailLoading(false);
                          setEmailError(
                            "Failed to initialize device with Circle (deviceId). Enable third-party cookies or disable privacy extensions, then try Reset email login."
                          );
                          console.warn(
                            "Send OTP blocked: ensureCircleDeviceId returned null"
                          );
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
                      !sdkReady
                    }
                    onClick={() => {
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
                        !sdkReady
                          ? "default"
                          : "pointer",
                      opacity:
                        !circleDeviceToken ||
                        !circleDeviceEncryptionKey ||
                        !circleOtpToken ||
                        !sdkReady
                          ? 0.7
                          : 1,
                    }}
                  >
                    Verify in Circle Window
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
                    gmailComingSoon ? (
                      <div
                        className="neonPlaceholder"
                        style={{
                          marginTop: 40,
                          padding: "32px 24px",
                          borderRadius: 16,
                          border: "1px solid rgba(0,255,255,0.6)",
                          background:
                            "radial-gradient(circle at top, rgba(0,255,255,0.35), rgba(0,0,0,0.6))",
                          boxShadow:
                            "0 0 25px rgba(0,255,255,0.5), 0 0 60px rgba(0,255,180,0.3)",
                          maxWidth: 460,
                          marginLeft: "auto",
                          marginRight: "auto",
                          textAlign: "center",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "1.1em",
                            fontWeight: 800,
                            marginBottom: 10,
                            background:
                              "linear-gradient(90deg,#00f0ff,#00ffb3,#8a7bff)",
                            WebkitBackgroundClip: "text",
                            color: "transparent",
                            letterSpacing: "1px",
                            textTransform: "uppercase",
                          }}
                        >
                          Gmail Connect – Coming Soon
                        </div>
                        <div
                          style={{
                            fontSize: "0.9em",
                            color: "#d7f9ff",
                            marginBottom: 20,
                            opacity: 0.9,
                          }}
                        >
                          We&apos;re finalizing email / Gmail login.
                          For now, please connect using your wallet to unlock
                          your SwapARC profile and badges.
                        </div>
                        <button
                          onClick={() => {
                            setGmailComingSoon(false);
                            connectWallet();
                          }}
                          style={{
                            padding: "10px 20px",
                            borderRadius: 999,
                            border: "none",
                            background:
                              "linear-gradient(90deg,#00f0ff,#00ffb7)",
                            color: "#001018",
                            fontWeight: 700,
                            cursor: "pointer",
                            boxShadow:
                              "0 0 18px rgba(0,255,255,0.6), 0 0 40px rgba(0,255,183,0.4)",
                          }}
                        >
                          Connect via Wallet
                        </button>
                      </div>
                    ) : (
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
                          }}
                        >
                          CONNECT WALLET or LINK YOUR EMAIL to continue
                        </div>
                      </div>
                    )
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
                                display: "grid",
                                gap: 10,
                                marginBottom: 25,
                                background: "rgba(0,0,0,0.2)",
                                padding: 15,
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
                              <div
                                style={{
                                  textAlign: "center",
                                  borderLeft: "1px solid rgba(255,255,255,0.1)",
                                  borderRight:
                                    "1px solid rgba(255,255,255,0.1)",
                                }}
                              >
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
                                  MY LIQUIDITY
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
                    COMING SOON
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
              LP balance:{" "}
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
