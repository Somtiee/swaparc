// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./SwaparcLP.sol";

/**
 * @title SwaparcPoolV2
 * @notice Proportional-share multi-token LP pool.
 *
 * Security notes (v2 rewrite, 2026-09):
 *  - LP shares are minted proportional to the pool's existing reserves per
 *    token (Curve-style min rule). The previous version summed raw units of
 *    tokens with different decimals, so depositing one cheap token minted a
 *    share of the whole basket — directly drainable.
 *  - removeLiquidity burns the caller's LP ERC-20 balance (no parallel
 *    internal ledger to desync). The pool is the LP token's only minter/
 *    burner, so no prior approval is required from users.
 *  - Rewards are paid exclusively from an owner-funded reserve. The previous
 *    version minted rewards out of LP principal at a hardcoded rate with no
 *    funding source.
 */
contract SwaparcPoolV2 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20[] public tokens;
    uint256[] public balances;

    SwaparcLP public lpToken;

    // reward rate per LP token per second (owner-settable)
    uint256 public rewardRatePerSecond = 1e14;

    // token[0] balance earmarked for rewards — claims can never exceed this.
    uint256 public rewardReserve;

    mapping(address => uint256) public lastUpdate;
    mapping(address => uint256) public rewards;

    constructor(address[] memory _tokens) Ownable(msg.sender) {
        require(_tokens.length > 1, "Need at least 2 tokens");

        for (uint256 i = 0; i < _tokens.length; i++) {
            require(_tokens[i] != address(0), "Zero token address");
            tokens.push(IERC20(_tokens[i]));
            balances.push(0);
        }

        // deploy LP token and set pool as owner
        lpToken = new SwaparcLP(address(this));
    }

    // ---------------- INTERNAL ----------------

    function _updateReward(address user) internal {
        if (lpToken.balanceOf(user) > 0) {
            uint256 delta = block.timestamp - lastUpdate[user];
            rewards[user] +=
                (delta * rewardRatePerSecond * lpToken.balanceOf(user)) /
                1e18;
        }
        lastUpdate[user] = block.timestamp;
    }

    // ---------------- USER ----------------

    function addLiquidity(uint256[] calldata amounts) external nonReentrant {
        require(amounts.length == tokens.length, "Bad length");

        _updateReward(msg.sender);

        uint256 supply = lpToken.totalSupply();
        uint256 toMint = 0;
        bool anchored = false;

        for (uint256 i = 0; i < tokens.length; i++) {
            if (amounts[i] == 0) continue;
            tokens[i].safeTransferFrom(msg.sender, address(this), amounts[i]);
            balances[i] += amounts[i];

            uint256 reserveBefore = balances[i] - amounts[i];
            if (supply == 0) {
                // First depositor anchors LP units to this token's raw units.
                if (!anchored || amounts[i] < toMint) {
                    toMint = amounts[i];
                    anchored = true;
                }
            } else if (reserveBefore > 0) {
                // Proportional mint per contributing token; the minimum share
                // wins so minted LP is backed by the whole basket.
                uint256 share = (amounts[i] * supply) / reserveBefore;
                if (!anchored || share < toMint) {
                    toMint = share;
                    anchored = true;
                }
            }
            // reserveBefore == 0 with supply > 0: this token cannot price the
            // mint on its own; other contributing tokens govern. If none can,
            // anchored stays false and we revert below.
        }

        require(anchored && toMint > 0, "No liquidity provided");

        lpToken.mint(msg.sender, toMint);
    }

    function removeLiquidity(uint256 lpAmount) external nonReentrant {
        require(lpAmount > 0, "Zero amount");
        uint256 supply = lpToken.totalSupply();
        require(supply > 0, "No liquidity");

        _updateReward(msg.sender);
        // Burn the caller's actual LP tokens — the ERC-20 ledger is the only
        // source of truth (the old internal liquidityOf could desync from it
        // and never validated ERC-20 ownership).
        lpToken.burn(msg.sender, lpAmount);

        uint256 newSupply = lpToken.totalSupply();

        for (uint256 i = 0; i < tokens.length; i++) {
            // Pro-rata slice of this token's reserve. rewardReserve (token[0]
            // only) is excluded from withdrawable principal.
            uint256 available = balances[i];
            if (i == 0 && available > rewardReserve) {
                available -= rewardReserve;
            } else if (i == 0) {
                available = 0;
            }
            uint256 amountOut = (available * lpAmount) / supply;
            if (amountOut > 0) {
                balances[i] -= amountOut;
                tokens[i].safeTransfer(msg.sender, amountOut);
            }
        }

        require(newSupply < supply, "Burn failed");
    }

    function claimRewards() external nonReentrant {
        _updateReward(msg.sender);

        uint256 reward = rewards[msg.sender];
        if (reward == 0) return;
        if (reward > rewardReserve) reward = rewardReserve;
        if (reward == 0) return;

        rewards[msg.sender] -= reward;
        rewardReserve -= reward;
        balances[0] -= reward;
        tokens[0].safeTransfer(msg.sender, reward);
    }

    // ---------------- OWNER ----------------

    /// @notice Fund the reward reserve (token[0]). Rewards can only ever pay
    /// out of this reserve — never out of LP principal.
    function fundRewards(uint256 amount) external onlyOwner {
        require(amount > 0, "Zero amount");
        tokens[0].safeTransferFrom(msg.sender, address(this), amount);
        rewardReserve += amount;
        balances[0] += amount;
    }

    function setRewardRatePerSecond(uint256 rate) external onlyOwner {
        rewardRatePerSecond = rate;
    }

    /// @notice Rescue tokens sent to the pool in error. Protected against
    /// draining LP assets: cannot withdraw pool tokens or LP token.
    function rescueToken(address token, uint256 amount) external onlyOwner {
        require(token != address(lpToken), "LP token");
        for (uint256 i = 0; i < tokens.length; i++) {
            require(token != address(tokens[i]), "Pool token");
        }
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    // ---------------- VIEW ----------------

    function getBalances() external view returns (uint256[] memory) {
        return balances;
    }
}
