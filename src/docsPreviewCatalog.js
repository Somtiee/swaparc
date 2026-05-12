import readme from "../docs/swaparc/README.md?raw";
import introHow from "../docs/swaparc/introduction/how-swaparc-works.md?raw";
import introWhat from "../docs/swaparc/introduction/what-is-swaparc.md?raw";
import introGlossary from "../docs/swaparc/introduction/networks-and-glossary.md?raw";
import gettingStartedGuide from "../docs/swaparc/getting-started/getting-started.md?raw";
import gettingStartedPrereq from "../docs/swaparc/getting-started/prerequisites-and-environment.md?raw";
import gettingStartedWallet from "../docs/swaparc/getting-started/connect-a-wallet.md?raw";
import gettingStartedWalletVsEmail from "../docs/swaparc/getting-started/wallet-vs-email-connect.md?raw";
import gettingStartedFirstRun from "../docs/swaparc/getting-started/first-swap-and-liquidity.md?raw";
import featureSwap from "../docs/swaparc/core-features/swap.md?raw";
import featurePools from "../docs/swaparc/core-features/pools-and-liquidity.md?raw";
import featurePrivpay from "../docs/swaparc/core-features/privpay.md?raw";
import buildLocal from "../docs/swaparc/build/local-development.md?raw";
import buildContracts from "../docs/swaparc/build/contracts-and-architecture.md?raw";
import buildPrivpayApi from "../docs/swaparc/build/api-reference-privpay.md?raw";
import buildSystemApi from "../docs/swaparc/build/api-reference-profile-and-system.md?raw";
import secOverview from "../docs/swaparc/security-and-privacy/security.md?raw";
import secThreat from "../docs/swaparc/security-and-privacy/threat-model.md?raw";
import secZk from "../docs/swaparc/security-and-privacy/zk-claim-security.md?raw";
import secKeys from "../docs/swaparc/security-and-privacy/key-management-and-backups.md?raw";
import opsRelayer from "../docs/swaparc/operate/relayer-operations.md?raw";
import opsJobs from "../docs/swaparc/operate/jobs-and-healthchecks.md?raw";
import supportFaq from "../docs/swaparc/support/faq.md?raw";
import supportTroubleshooting from "../docs/swaparc/support/troubleshooting.md?raw";

/** @typedef {'user' | 'developer'} DocsAudience */

/**
 * Sidebar: user-facing pages first, then developer / operator pages.
 * @type {{ audience: DocsAudience, label: string, pages: { id: string, title: string, markdown: string }[] }[]}
 */
export const DOCS_PREVIEW_SECTIONS = [
  {
    audience: "user",
    label: "Introduction",
    pages: [
      { id: "readme", title: "Overview", markdown: readme },
      { id: "how-swaparc-works", title: "How SwapArc works", markdown: introHow },
      { id: "what-is-swaparc", title: "What is SwapArc", markdown: introWhat },
      { id: "networks-and-glossary", title: "Networks & glossary", markdown: introGlossary },
    ],
  },
  {
    audience: "user",
    label: "Get started",
    pages: [
      { id: "getting-started", title: "Getting started", markdown: gettingStartedGuide },
      { id: "connect-a-wallet", title: "Connect a wallet", markdown: gettingStartedWallet },
      {
        id: "wallet-vs-email-connect",
        title: "Wallet vs email connect",
        markdown: gettingStartedWalletVsEmail,
      },
      {
        id: "first-swap-and-liquidity",
        title: "First swap & liquidity",
        markdown: gettingStartedFirstRun,
      },
    ],
  },
  {
    audience: "user",
    label: "Using SwapArc",
    pages: [
      { id: "swap", title: "Swap", markdown: featureSwap },
      { id: "pools-and-liquidity", title: "Pools & liquidity", markdown: featurePools },
      { id: "privpay", title: "PrivPay", markdown: featurePrivpay },
    ],
  },
  {
    audience: "user",
    label: "Help",
    pages: [
      { id: "faq", title: "FAQ", markdown: supportFaq },
      { id: "troubleshooting", title: "Troubleshooting", markdown: supportTroubleshooting },
    ],
  },
  {
    audience: "developer",
    label: "Environment & build",
    pages: [
      {
        id: "prerequisites-and-environment",
        title: "Prerequisites & environment",
        markdown: gettingStartedPrereq,
      },
      { id: "local-development", title: "Local development", markdown: buildLocal },
      {
        id: "contracts-and-architecture",
        title: "Contracts & architecture",
        markdown: buildContracts,
      },
    ],
  },
  {
    audience: "developer",
    label: "API reference",
    pages: [
      { id: "api-reference-privpay", title: "PrivPay relay & API", markdown: buildPrivpayApi },
      {
        id: "api-reference-profile-and-system",
        title: "Profile & system API",
        markdown: buildSystemApi,
      },
    ],
  },
  {
    audience: "developer",
    label: "Security & operations",
    pages: [
      { id: "security", title: "Security overview", markdown: secOverview },
      { id: "threat-model", title: "Threat model", markdown: secThreat },
      { id: "zk-claim-security", title: "ZK claim security", markdown: secZk },
      { id: "key-management-and-backups", title: "Key management & backups", markdown: secKeys },
      { id: "relayer-operations", title: "Relayer operations", markdown: opsRelayer },
      { id: "jobs-and-healthchecks", title: "Jobs & health checks", markdown: opsJobs },
    ],
  },
];

const AUDIENCE_LABEL = /** @type {const} */ ({
  user: "User guide",
  developer: "Developers & operators",
});

export const DEFAULT_DOC_PAGE_ID = "readme";

/** Linear reading order for prev / next navigation. */
export const DOCS_FLAT_PAGES = DOCS_PREVIEW_SECTIONS.flatMap((section) =>
  section.pages.map((page) => ({
    ...page,
    navSection: section.label,
    audience: section.audience,
    audienceLabel: AUDIENCE_LABEL[section.audience],
  }))
);
