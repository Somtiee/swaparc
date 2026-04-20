// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IPrivacyPoolMinimal {
    function token() external view returns (address);
    function depositFor(address from, bytes32 commitment, uint256 amount) external;
}

/**
 * @title RecurringPoolAutomation
 * @notice Payer-authorized recurring execution guard for privacy-pool deposits.
 * @dev The payer grants ERC20 allowance to this contract. A designated executor can only
 *      pull funds under per-execution + per-period caps and can only deposit into
 *      the configured privacy pool/token pair. Payer can pause/cancel anytime.
 */
contract RecurringPoolAutomation {
    struct Authorization {
        address payer;
        address executor;
        address token;
        address pool;
        uint128 maxAmountPerExecution;
        uint128 maxAmountPerPeriod;
        uint128 spentInPeriod;
        uint64 periodSeconds;
        uint64 periodWindowStart;
        bool active;
    }

    mapping(bytes32 => Authorization) public authorizations;

    error InvalidAddress();
    error InvalidLimits();
    error InvalidPeriod();
    error NotPayer();
    error NotExecutor();
    error AuthorizationInactive();
    error AmountTooHigh();
    error PeriodLimitExceeded();
    error TokenPoolMismatch();
    error TransferFailed();
    error ApproveFailed();

    event AuthorizationConfigured(
        bytes32 indexed authId,
        address indexed payer,
        address indexed executor,
        address token,
        address pool,
        uint128 maxAmountPerExecution,
        uint128 maxAmountPerPeriod,
        uint64 periodSeconds
    );
    event AuthorizationCancelled(bytes32 indexed authId, address indexed payer);
    event AuthorizationPaused(bytes32 indexed authId, address indexed payer, bool active);
    event AuthorizationExecuted(
        bytes32 indexed authId,
        address indexed payer,
        address indexed executor,
        bytes32 commitment,
        uint256 amount,
        uint64 periodWindowStart,
        uint128 spentInPeriod
    );

    function configureAuthorization(
        bytes32 authId,
        address executor,
        address token,
        address pool,
        uint128 maxAmountPerExecution,
        uint128 maxAmountPerPeriod,
        uint64 periodSeconds
    ) external {
        if (executor == address(0) || token == address(0) || pool == address(0)) revert InvalidAddress();
        if (maxAmountPerExecution == 0 || maxAmountPerPeriod == 0) revert InvalidLimits();
        if (maxAmountPerExecution > maxAmountPerPeriod) revert InvalidLimits();
        if (periodSeconds < 60) revert InvalidPeriod();
        if (IPrivacyPoolMinimal(pool).token() != token) revert TokenPoolMismatch();

        Authorization storage a = authorizations[authId];
        if (a.payer != address(0) && a.payer != msg.sender) revert NotPayer();

        uint64 nowTs = uint64(block.timestamp);
        authorizations[authId] = Authorization({
            payer: msg.sender,
            executor: executor,
            token: token,
            pool: pool,
            maxAmountPerExecution: maxAmountPerExecution,
            maxAmountPerPeriod: maxAmountPerPeriod,
            spentInPeriod: 0,
            periodSeconds: periodSeconds,
            periodWindowStart: nowTs,
            active: true
        });

        emit AuthorizationConfigured(
            authId,
            msg.sender,
            executor,
            token,
            pool,
            maxAmountPerExecution,
            maxAmountPerPeriod,
            periodSeconds
        );
    }

    function setAuthorizationActive(bytes32 authId, bool active) external {
        Authorization storage a = authorizations[authId];
        if (a.payer == address(0)) revert NotPayer();
        if (a.payer != msg.sender) revert NotPayer();
        a.active = active;
        emit AuthorizationPaused(authId, msg.sender, active);
    }

    function cancelAuthorization(bytes32 authId) external {
        Authorization memory a = authorizations[authId];
        if (a.payer == address(0) || a.payer != msg.sender) revert NotPayer();
        delete authorizations[authId];
        emit AuthorizationCancelled(authId, msg.sender);
    }

    function executePoolDeposit(bytes32 authId, bytes32 commitment, uint256 amount) external {
        Authorization storage a = authorizations[authId];
        if (!a.active) revert AuthorizationInactive();
        if (msg.sender != a.executor) revert NotExecutor();
        if (amount == 0 || amount > a.maxAmountPerExecution) revert AmountTooHigh();

        uint64 nowTs = uint64(block.timestamp);
        if (nowTs >= a.periodWindowStart + a.periodSeconds) {
            a.periodWindowStart = nowTs;
            a.spentInPeriod = 0;
        }

        uint256 nextSpent = uint256(a.spentInPeriod) + amount;
        if (nextSpent > uint256(a.maxAmountPerPeriod)) revert PeriodLimitExceeded();
        a.spentInPeriod = uint128(nextSpent);

        if (!_safeTransferFrom(a.token, a.payer, address(this), amount)) revert TransferFailed();
        if (!_safeApprove(a.token, a.pool, amount)) revert ApproveFailed();
        IPrivacyPoolMinimal(a.pool).depositFor(address(this), commitment, amount);
        if (!_safeApprove(a.token, a.pool, 0)) revert ApproveFailed();

        emit AuthorizationExecuted(
            authId,
            a.payer,
            msg.sender,
            commitment,
            amount,
            a.periodWindowStart,
            a.spentInPeriod
        );
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private returns (bool) {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transferFrom.selector, from, to, amount)
        );
        return ok && (data.length == 0 || abi.decode(data, (bool)));
    }

    function _safeApprove(address token, address spender, uint256 amount) private returns (bool) {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, amount)
        );
        return ok && (data.length == 0 || abi.decode(data, (bool)));
    }
}
