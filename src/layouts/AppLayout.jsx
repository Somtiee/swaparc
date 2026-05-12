import SwaparcApp from "../SwaparcApp.jsx";

/**
 * Main application shell (swap, pools, privpay, profile, landing).
 * Routed at `/*` separately from {@link DocsLayout} at `/docs/*`.
 */
export default function AppLayout() {
  return <SwaparcApp />;
}
