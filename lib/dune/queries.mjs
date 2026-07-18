/**
 * Dune SQL queries for SwapArc dashboard widgets.
 * {{NS}} is replaced with your upload namespace.
 */

/** Queries removed from dashboard — archived on publish. */
export const DUNE_ARCHIVED_QUERY_KEYS = [
  "history_volume",
  "v2_daily_volume",
  "privpay_daily",
  "top_traders_volume",
  "top_lp",
  "all_traders_search",
  "all_lp_search",
];

export const DUNE_QUERY_SPECS = [
  {
    key: "kpi_total_swaps",
    name: "SwapArc — Total Swaps (platform)",
    description:
      "Cumulative swap transactions across SwapArc since launch. This number matches the live counter on swaparc.app.",
    tags: ["swaparc", "overview"],
    sql: `SELECT total_swap_count AS total_swaps
FROM dune.{{NS}}.dataset_swaparc_network_totals`,
  },
  {
    key: "kpi_total_volume",
    name: "SwapArc — Total Swap Volume USD (platform)",
    description:
      "Total notional swap volume in USD across the protocol. Updated weekly from the same pipeline that powers the SwapArc homepage.",
    tags: ["swaparc", "overview"],
    sql: `SELECT ROUND(total_swap_volume_usd, 2) AS total_volume_usd
FROM dune.{{NS}}.dataset_swaparc_network_totals`,
  },
  {
    key: "kpi_unique_users",
    name: "SwapArc — Unique Users",
    description:
      "Distinct wallets with swap activity, liquidity deposits, or an active SwapArc profile on Arc testnet.",
    tags: ["swaparc", "overview"],
    sql: `SELECT unique_users
FROM dune.{{NS}}.dataset_swaparc_network_totals`,
  },
  {
    key: "kpi_refreshed_at",
    name: "SwapArc — Last Refresh",
    description: "When network-wide stats were last synced from swaparc.app.",
    tags: ["swaparc", "overview"],
    sql: `SELECT refreshed_at AS last_refresh
FROM dune.{{NS}}.dataset_swaparc_network_totals`,
  },
  {
    key: "pool_segments",
    name: "SwapArc — Pool Segment Summary",
    description:
      "Swap volume and activity across the legacy pool, V2 pool, and combined network totals.",
    tags: ["swaparc", "swaps"],
    sql: `SELECT
  segment,
  total_swaps,
  ROUND(platform_volume_usd, 2) AS platform_volume_usd,
  ROUND(on_chain_volume_usd, 2) AS on_chain_volume_usd,
  unique_wallets,
  notes
FROM dune.{{NS}}.dataset_swaparc_swap_pool_total
ORDER BY
  CASE segment
    WHEN 'SWAP POOL (TOTAL)' THEN 0
    WHEN 'OLD SWAP POOL' THEN 1
    ELSE 2
  END`,
  },
  {
    key: "volume_methodology",
    name: "SwapArc — Volume Methodology",
    description:
      "Side-by-side comparison of how SwapArc reports volume: platform totals (homepage) vs. on-chain swap legs priced at execution.",
    tags: ["swaparc", "overview"],
    sql: `SELECT
  metric,
  value_text,
  swap_count,
  explanation
FROM (
  SELECT
    1 AS ord,
    'Platform total (swaparc.app landing)' AS metric,
    CAST(ROUND(total_swap_volume_usd, 2) AS varchar) AS value_text,
    total_swap_count AS swap_count,
    'Profile-indexed totals published weekly on swaparc.app' AS explanation
  FROM dune.{{NS}}.dataset_swaparc_network_totals
  UNION ALL
  SELECT
    2,
    'On-chain priced (verified swap legs)',
    CAST(ROUND(on_chain_volume_usd, 2) AS varchar),
    total_swaps,
    notes
  FROM dune.{{NS}}.dataset_swaparc_swap_pool_total
  WHERE segment = 'SWAP POOL (TOTAL)'
) t
ORDER BY ord`,
  },
  {
    key: "v2_top_pairs",
    name: "SwapArc — V2 Top Token Pairs",
    description: "Most-traded token routes on the V2 swap pool, ranked by USD volume.",
    tags: ["swaparc", "swaps"],
    sql: `SELECT
  CONCAT(token_in_symbol, ' → ', token_out_symbol) AS pair,
  COUNT(*) AS swaps,
  ROUND(SUM(usd_volume), 2) AS volume_usd
FROM dune.{{NS}}.dataset_swaparc_new_swap_pool
GROUP BY 1
ORDER BY volume_usd DESC
LIMIT 15`,
  },
  {
    key: "all_traders_browse",
    name: "SwapArc — All Traders",
    description:
      "Every active trader ranked by swap volume. Search a username or wallet address, or page through the full list (25 rows per page).",
    tags: ["swaparc", "swaps", "leaderboard"],
    sql: `SELECT
  CAST(rank_by_volume AS bigint) AS rank,
  CAST(rank_by_lp AS bigint) AS lp_rank,
  username,
  CAST(wallet AS varchar) AS wallet,
  ROUND(CAST(swap_volume AS double), 2) AS swap_volume_usd,
  CAST(swap_count AS bigint) AS swap_count,
  ROUND(CAST(lp_provided AS double), 2) AS lp_provided_usd
FROM dune.{{NS}}.dataset_swaparc_all_profiles
ORDER BY CAST(rank_by_volume AS bigint) NULLS LAST, CAST(wallet AS varchar)`,
  },
  {
    key: "all_traders_count",
    name: "SwapArc — Trader Directory Stats",
    description: "Total profiles in the directory and how many have recorded swap volume.",
    tags: ["swaparc", "swaps", "leaderboard"],
    sql: `SELECT
  COUNT(*) AS total_profiles,
  SUM(CASE WHEN CAST(swap_volume AS double) > 0 THEN 1 ELSE 0 END) AS traders_with_volume
FROM dune.{{NS}}.dataset_swaparc_all_profiles`,
  },
  {
    key: "all_lp_browse",
    name: "SwapArc — All Liquidity Providers",
    description:
      "Liquidity providers ranked by capital deposited. Search any address or username, or browse the full list.",
    tags: ["swaparc", "liquidity", "leaderboard"],
    sql: `SELECT
  CAST(rank_by_lp AS bigint) AS lp_rank,
  CAST(rank_by_volume AS bigint) AS volume_rank,
  username,
  CAST(wallet AS varchar) AS wallet,
  ROUND(CAST(lp_provided AS double), 2) AS lp_provided_usd,
  ROUND(CAST(swap_volume AS double), 2) AS swap_volume_usd,
  CAST(swap_count AS bigint) AS swap_count
FROM dune.{{NS}}.dataset_swaparc_all_profiles
ORDER BY
  CASE WHEN CAST(lp_provided AS double) > 0 THEN 0 ELSE 1 END,
  CAST(rank_by_lp AS bigint) NULLS LAST,
  CAST(rank_by_volume AS bigint) NULLS LAST,
  CAST(wallet AS varchar)`,
  },
  {
    key: "kpi_total_tvl",
    name: "SwapArc — Total TVL (platform)",
    description:
      "Combined value locked across all SwapArc LP pools — USDC/EURC, USDC/SWPRC, and EURC/SWPRC. Read live from chain; matches swaparc.app.",
    tags: ["swaparc", "overview", "liquidity"],
    sql: `SELECT ROUND(SUM(CAST(pool_tvl_usd AS double)), 2) AS total_tvl_usd
FROM dune.{{NS}}.dataset_swaparc_lp_pools`,
  },
  {
    key: "kpi_active_lp_pools",
    name: "SwapArc — Active LP Pools",
    description: "Live two-sided liquidity pools currently deployed on Arc testnet.",
    tags: ["swaparc", "overview", "liquidity"],
    sql: `SELECT COUNT(*) AS active_pools
FROM dune.{{NS}}.dataset_swaparc_lp_pools`,
  },
  {
    key: "pool_tvl",
    name: "SwapArc — LP Pool Breakdown",
    description:
      "Reserves in each LP pool: both tokens held, their USD value, and total pool TVL.",
    tags: ["swaparc", "liquidity"],
    sql: `SELECT
  pool_name,
  token_a_symbol,
  ROUND(CAST(token_a_locked AS double), 2) AS token_a_locked,
  ROUND(CAST(token_a_usd AS double), 2) AS token_a_usd,
  token_b_symbol,
  ROUND(CAST(token_b_locked AS double), 2) AS token_b_locked,
  ROUND(CAST(token_b_usd AS double), 2) AS token_b_usd,
  ROUND(CAST(pool_tvl_usd AS double), 2) AS pool_tvl_usd,
  refreshed_at
FROM dune.{{NS}}.dataset_swaparc_lp_pools
ORDER BY CAST(pool_tvl_usd AS double) DESC`,
  },
  {
    key: "pool_tvl_bar",
    name: "SwapArc — TVL by Pool",
    description: "How total liquidity is distributed across the three SwapArc LP pools.",
    tags: ["swaparc", "liquidity", "chart"],
    sql: `SELECT
  pool_name,
  ROUND(CAST(pool_tvl_usd AS double), 2) AS pool_tvl_usd
FROM dune.{{NS}}.dataset_swaparc_lp_pools
ORDER BY CAST(pool_tvl_usd AS double) DESC`,
  },
  {
    key: "pool_token_usd_bar",
    name: "SwapArc — Token USD by Pool",
    description: "USD value of USDC, EURC, and SWPRC reserves inside each pool.",
    tags: ["swaparc", "liquidity", "chart"],
    sql: `SELECT pool_name, token_symbol, ROUND(CAST(usd_value AS double), 2) AS usd_value
FROM (
  SELECT pool_name, token_a_symbol AS token_symbol, token_a_usd AS usd_value
  FROM dune.{{NS}}.dataset_swaparc_lp_pools
  UNION ALL
  SELECT pool_name, token_b_symbol, token_b_usd
  FROM dune.{{NS}}.dataset_swaparc_lp_pools
) t
ORDER BY pool_name, token_symbol`,
  },
  {
    key: "pool_token_locked",
    name: "SwapArc — Token Amounts by Pool",
    description: "Raw token balances held on-chain in each liquidity pool.",
    tags: ["swaparc", "liquidity"],
    sql: `SELECT pool_name, token_symbol, ROUND(CAST(amount_locked AS double), 4) AS amount_locked
FROM (
  SELECT pool_name, token_a_symbol AS token_symbol, token_a_locked AS amount_locked
  FROM dune.{{NS}}.dataset_swaparc_lp_pools
  UNION ALL
  SELECT pool_name, token_b_symbol, token_b_locked
  FROM dune.{{NS}}.dataset_swaparc_lp_pools
) t
ORDER BY pool_name, token_symbol`,
  },
  {
    key: "privpay_summary",
    name: "SwapArc — PrivPay Deposits & Withdrawals",
    description:
      "PrivPay deposit and withdrawal activity on Arc testnet, broken out by token and event type.",
    tags: ["swaparc", "privpay"],
    sql: `SELECT
  token_symbol,
  event_type,
  COUNT(*) AS events,
  ROUND(SUM(CAST(amount AS double)), 2) AS total_amount
FROM dune.{{NS}}.dataset_swaparc_privpay
GROUP BY 1, 2
ORDER BY token_symbol, event_type`,
  },
  {
    key: "privpay_by_token",
    name: "SwapArc — PrivPay Totals by Token",
    description: "PrivPay usage per token — total events, deposit/withdraw counts, and amounts.",
    tags: ["swaparc", "privpay"],
    sql: `SELECT
  token_symbol,
  COUNT(*) AS total_events,
  SUM(CASE WHEN event_type = 'deposit' THEN 1 ELSE 0 END) AS deposits,
  SUM(CASE WHEN event_type = 'withdraw' THEN 1 ELSE 0 END) AS withdrawals,
  ROUND(SUM(CASE WHEN event_type = 'deposit' THEN CAST(amount AS double) ELSE 0 END), 2) AS deposit_amount,
  ROUND(SUM(CASE WHEN event_type = 'withdraw' THEN CAST(amount AS double) ELSE 0 END), 2) AS withdraw_amount
FROM dune.{{NS}}.dataset_swaparc_privpay
GROUP BY 1
ORDER BY total_events DESC`,
  },
  {
    key: "legacy_pool_summary",
    name: "SwapArc — Legacy Pool Summary",
    description:
      "Activity on the original SwapArc pool before the V2 migration — platform totals vs. verified on-chain rows.",
    tags: ["swaparc", "swaps"],
    sql: `SELECT
  platform_swap_count,
  on_chain_swap_rows,
  ROUND(platform_volume_usd, 2) AS platform_volume_usd,
  ROUND(on_chain_usd_volume, 2) AS on_chain_volume_usd,
  unique_wallets,
  notes
FROM dune.{{NS}}.dataset_swaparc_old_swap_pool_summary`,
  },
];

export function sqlForNamespace(spec, namespace) {
  return spec.sql.replaceAll("{{NS}}", namespace);
}
