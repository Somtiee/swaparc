import { useState } from "react";

/**
 * Testnet → Mainnet interstitial.
 *
 * Shown on production builds while the Arc testnet chapter is closed and the
 * mainnet deployment is being prepared. Enabled by default on prod builds
 * (opt out with VITE_TESTNET_SUNSET=0); dev builds opt in with
 * VITE_TESTNET_SUNSET=1. The escape hatch into the testnet app is
 * visit-scoped only — a (hard) refresh always returns to this page.
 */
export default function TestnetSunsetScreen({ onContinue }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const continueToApp = () => {
    setDismissed(true);
    if (typeof onContinue === "function") onContinue();
  };

  return (
    <div className="testnetSunsetPage">
      <div className="testnetSunsetGlow testnetSunsetGlowOne" />
      <div className="testnetSunsetGlow testnetSunsetGlowTwo" />

      <section className="testnetSunsetCard">
        <p className="landingHeroEyebrow">SwapARC on Arc</p>

        <h1 className="testnetSunsetTitle">TESTNET COMPLETE!!!.</h1>

        <p className="testnetSunsetCopy">
          The testnet chapter is officially over. Every swap, every LP position
          and every milestone you hit has been recorded. Your profile, stats,
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
            Testnet progress: Stored
          </div>
          <div className="testnetSunsetStatus">
            <span className="testnetSunsetStatusDot testnetSunsetStatusDotDone" />
            Badges: Locked in
          </div>
          <div className="testnetSunsetStatus">
            <span className="testnetSunsetStatusDot testnetSunsetStatusDotPulse" />
            Mainnet??? loading
          </div>
        </div>

        <p className="testnetSunsetMainnetCopy">
          Stay tuned for the real deal: <strong>SwapARC on mainnet</strong> is
          on the way.
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
