import { useState } from "react";

/**
 * Testnet → Mainnet interstitial.
 *
 * Shown on production builds while the Arc testnet chapter is closed and the
 * mainnet deployment is being prepared. Enabled via VITE_TESTNET_SUNSET=1 at
 * build time (see .env.example). A small escape hatch keeps the testnet app
 * reachable; the dismissal is remembered per browser.
 */
const DISMISS_KEY = "swaparc:testnetSunsetDismissed";

function readDismissed() {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export default function TestnetSunsetScreen({ onContinue }) {
  const [dismissed, setDismissed] = useState(readDismissed);

  if (dismissed) return null;

  const continueToApp = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode / storage blocked — session-only dismissal */
    }
    setDismissed(true);
    if (typeof onContinue === "function") onContinue();
  };

  return (
    <div className="testnetSunsetPage">
      <div className="testnetSunsetGlow testnetSunsetGlowOne" />
      <div className="testnetSunsetGlow testnetSunsetGlowTwo" />

      <section className="testnetSunsetCard">
        <p className="landingHeroEyebrow">SwapARC on Arc</p>

        <h1 className="testnetSunsetTitle">Testnet, complete.</h1>

        <p className="testnetSunsetCopy">
          The testnet chapter is officially over. Every swap, every LP position,
          and every milestone you hit has been recorded — your profile, stats,
          and badges are stored and carried forward.
        </p>

        <div className="testnetSunsetBadgeRow">
          <div className="testnetSunsetBadge">
            <img src="/badges/early-swaparcer.png" alt="Early Swaparcer badge" />
            <span>Early Swaparcer</span>
            <small>earned &amp; stored</small>
          </div>
          <div className="testnetSunsetBadge">
            <img src="/badges/elite-swaparcer.png" alt="Elite Swaparcer badge" />
            <span>Elite Swaparcer</span>
            <small>earned &amp; stored</small>
          </div>
        </div>

        <div className="testnetSunsetStatusRow">
          <div className="testnetSunsetStatus">
            <span className="testnetSunsetStatusDot testnetSunsetStatusDotDone" />
            Testnet progress — stored
          </div>
          <div className="testnetSunsetStatus">
            <span className="testnetSunsetStatusDot testnetSunsetStatusDotDone" />
            Badges — locked in
          </div>
          <div className="testnetSunsetStatus">
            <span className="testnetSunsetStatusDot testnetSunsetStatusDotPulse" />
            Mainnet — loading
          </div>
        </div>

        <p className="testnetSunsetMainnetCopy">
          Stay tuned for the real deal: <strong>SwapARC on mainnet</strong> is
          next.
        </p>

        <button
          type="button"
          className="testnetSunsetContinueBtn"
          onClick={continueToApp}
        >
          Explore the testnet app anyway
        </button>
      </section>
    </div>
  );
}
