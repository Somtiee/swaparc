// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title StableSwapPoolV2
 * @notice Upgradeable N-token stable-swap pool for Swaparc (UUPS / ERC-1967).
 * @dev Owner can list tokens (`addToken`), seed liquidity, withdraw for ops, pause, and
 *      authorize implementation upgrades. Swaps are public when unpaused.
 */
contract StableSwapPoolV2 is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    uint256 public constant PRECISION = 1e18;
    /// @dev Hard cap on swap fee (1%). Set lower at initialize for production (e.g. 4 bps).
    uint256 public constant MAX_FEE_BPS = 100;

    address[] public tokens;
    uint256[] public balances;
    /// @dev Per-token scale: 10^(18 - decimals) for normalized stable-swap math.
    uint256[] public rates;
    uint256 public A;
    /// @dev Fee in basis points (4 = 0.04%).
    uint256 public fee;

    event TokenAdded(address indexed token, uint256 indexed index);
    event LiquidityAdded(uint256[] amounts);
    event OwnerWithdraw(address indexed token, uint256 amount, address indexed to);
    event Swapped(address indexed user, uint256 i, uint256 j, uint256 dx, uint256 dy);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address[] calldata _tokens,
        uint256 _A,
        uint256 _fee
    ) external initializer {
        if (_tokens.length < 2) revert("need >=2 tokens");
        if (_A == 0) revert("A=0");
        if (_fee > MAX_FEE_BPS) revert("fee high");
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        A = _A;
        fee = _fee;
        for (uint256 i = 0; i < _tokens.length; i++) {
            _pushToken(_tokens[i]);
        }
    }

    function addToken(address token) external onlyOwner {
        if (_findTokenIndex(token) != type(uint256).max) revert("duplicate");
        _pushToken(token);
        emit TokenAdded(token, tokens.length - 1);
    }

    function getTokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function getBalances() external view returns (uint256[] memory) {
        return balances;
    }

    function getRates() external view returns (uint256[] memory) {
        return rates;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function addLiquidity(uint256[] calldata amounts) external onlyOwner nonReentrant {
        if (amounts.length != tokens.length) revert("length mismatch");
        for (uint256 i = 0; i < tokens.length; i++) {
            if (amounts[i] > 0) {
                IERC20(tokens[i]).safeTransferFrom(msg.sender, address(this), amounts[i]);
                balances[i] += amounts[i];
            }
        }
        emit LiquidityAdded(amounts);
    }

    function ownerWithdraw(uint256 i, uint256 amount, address to) external onlyOwner nonReentrant {
        if (i >= tokens.length) revert("bad index");
        if (to == address(0)) revert("zero to");
        if (amount == 0 || balances[i] < amount) revert("bad amount");
        balances[i] -= amount;
        IERC20(tokens[i]).safeTransfer(to, amount);
        emit OwnerWithdraw(tokens[i], amount, to);
    }

    function get_dy(uint256 i, uint256 j, uint256 dx) external view returns (uint256) {
        if (dx == 0) return 0;
        if (i >= tokens.length || j >= tokens.length || i == j) revert("bad idx");
        uint256[] memory xp = _xp();
        uint256 dxNorm = dx * rates[i];
        uint256 x = xp[i] + dxNorm;
        uint256 y = _getY(i, j, x, xp);
        if (y >= xp[j]) return 0;
        uint256 dyNorm = xp[j] - y;
        uint256 feeAmount = (dyNorm * fee) / 10_000;
        dyNorm -= feeAmount;
        return dyNorm / rates[j];
    }

    function swap(uint256 i, uint256 j, uint256 dx)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 dy)
    {
        if (dx == 0) revert("dx=0");
        if (i >= tokens.length || j >= tokens.length || i == j) revert("bad idx");
        IERC20(tokens[i]).safeTransferFrom(msg.sender, address(this), dx);

        uint256[] memory xp = _xp();
        uint256 dxNorm = dx * rates[i];
        uint256 x = xp[i] + dxNorm;
        uint256 y = _getY(i, j, x, xp);
        if (y >= xp[j]) revert("insufficient liquidity");
        uint256 dyNorm = xp[j] - y;
        uint256 feeAmount = (dyNorm * fee) / 10_000;
        dyNorm -= feeAmount;
        dy = dyNorm / rates[j];
        if (dy == 0) revert("dy=0");
        if (balances[j] < dy) revert("pool balance");

        balances[i] += dx;
        balances[j] -= dy;

        IERC20(tokens[j]).safeTransfer(msg.sender, dy);
        emit Swapped(msg.sender, i, j, dx, dy);
    }

    function _findTokenIndex(address token) internal view returns (uint256) {
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == token) return i;
        }
        return type(uint256).max;
    }

    function _pushToken(address token) internal {
        if (token == address(0)) revert("zero token");
        tokens.push(token);
        balances.push(0);
        uint8 dec = IERC20Metadata(token).decimals();
        if (dec > 18) revert("decimals");
        rates.push(10 ** uint256(18 - dec));
    }

    function _xp() internal view returns (uint256[] memory xp) {
        uint256 n = tokens.length;
        xp = new uint256[](n);
        for (uint256 k = 0; k < n; k++) {
            // Keep full precision (balance * rate) so 8-decimal tokens with small
            // balances do not round to zero before stable-swap math runs.
            xp[k] = balances[k] * rates[k];
        }
    }

    function _getD(uint256[] memory xp) internal view returns (uint256 D) {
        uint256 S;
        uint256 N = xp.length;
        for (uint256 i = 0; i < N; i++) {
            S += xp[i];
        }
        if (S == 0) return 0;

        D = S;
        uint256 Ann = A * N;

        for (uint256 _i = 0; _i < 255; _i++) {
            uint256 D_P = D;
            for (uint256 i = 0; i < N; i++) {
                D_P = (D_P * D) / (xp[i] * N);
            }

            uint256 Dprev = D;
            D = (Ann * S + D_P * N) * D / ((Ann - 1) * D + (N + 1) * D_P);
            if (D > Dprev ? D - Dprev <= 1 : Dprev - D <= 1) break;
        }
    }

    function _getY(
        uint256 i,
        uint256 j,
        uint256 x,
        uint256[] memory xp
    ) internal view returns (uint256 y) {
        uint256 N = xp.length;
        uint256 D = _getD(xp);
        uint256 Ann = A * N;

        uint256 c = D;
        uint256 S;

        for (uint256 k = 0; k < N; k++) {
            uint256 _x;
            if (k == i) _x = x;
            else if (k == j) continue;
            else _x = xp[k];

            S += _x;
            c = (c * D) / (_x * N);
        }

        c = (c * D) / (Ann * N);
        uint256 b = S + D / Ann;

        y = D;
        for (uint256 _i = 0; _i < 255; _i++) {
            uint256 yPrev = y;
            y = (y * y + c) / (2 * y + b - D);
            if (y > yPrev ? y - yPrev <= 1 : yPrev - y <= 1) break;
        }
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    uint256[48] private __gap;
}
