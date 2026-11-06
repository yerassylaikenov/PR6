// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {RetailPurchaseOrder} from "../retail/RetailPurchaseOrder.sol";
import {PaymentOrderRegistry} from "../bank/PaymentOrderRegistry.sol";

/**
 * @title OrderSettlementHub (integration contract, PR6)
 * @notice Links a purchase order of Module B (retail) with a payment order of Module A
 *         (bank) by the common orderId and sets the final order status. The hub never
 *         trusts the orchestrator's data: it re-reads both modules on-chain (CP-4).
 * @dev OWASP SC Top 10 (2025):
 *      SC01 Access Control - linkPayment only ORCHESTRATOR_ROLE (msg.sender, no tx.origin);
 *           finalize is permissionless because every input is read from the modules.
 *      SC03 Logic Errors   - strict state machine None -> AwaitingPayment -> {Paid | PaymentFailed}.
 *      SC04 Input Validation - amount/docHash/status cross-check against both modules.
 *      SC10 DoS            - no loops, no value transfer; only view calls to two immutable modules.
 */
contract OrderSettlementHub is AccessControl, Pausable {
    bytes32 public constant ORCHESTRATOR_ROLE = keccak256("ORCHESTRATOR_ROLE");

    enum OrderStatus {
        None,
        AwaitingPayment,
        Paid,
        PaymentFailed
    }

    struct OrderLink {
        bytes32 paymentId;
        uint32 attempt;
        bytes32 docHash;
        uint128 amount;
        OrderStatus status;
        uint64 linkedAt;
        uint64 finalizedAt;
    }

    // Module addresses are fixed at deployment (no address substitution, SC01/SC10).
    RetailPurchaseOrder public immutable retail;
    PaymentOrderRegistry public immutable bank;

    mapping(bytes32 => OrderLink) private _links;

    event OrderPaymentLinked(
        bytes32 indexed orderId, bytes32 indexed paymentId, uint32 attempt, uint128 amount, bytes32 docHash
    );
    event OrderFinalized(bytes32 indexed orderId, bytes32 indexed paymentId, OrderStatus finalStatus);

    error ZeroAddress();
    error InvalidAttempt();
    error PONotApproved(bytes32 orderId);
    error PaymentNotRegistered(bytes32 paymentId);
    error AmountMismatch(uint128 poAmount, uint128 paymentAmount);
    error DocHashMismatch(bytes32 poHash, bytes32 docHash);
    error AlreadyLinked(bytes32 orderId, uint32 attempt);
    error PreviousAttemptActive(bytes32 orderId, uint32 attempt);
    error AlreadyFinalized(bytes32 orderId);
    error NotLinked(bytes32 orderId);
    error NotSettledYet(bytes32 orderId);

    constructor(address retailModule, address bankModule, address admin) {
        if (retailModule == address(0) || bankModule == address(0) || admin == address(0)) revert ZeroAddress();
        retail = RetailPurchaseOrder(retailModule);
        bank = PaymentOrderRegistry(bankModule);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice paymentId used by Module A for (orderId, attempt).
    function paymentIdFor(bytes32 orderId, uint32 attempt) public pure returns (bytes32) {
        return keccak256(abi.encode(orderId, attempt));
    }

    /// @notice Link the registered bank payment to the approved PO after on-chain cross-check (CP-4).
    function linkPayment(bytes32 orderId, uint32 attempt)
        external
        onlyRole(ORCHESTRATOR_ROLE) // SC01
        whenNotPaused
    {
        if (attempt == 0) revert InvalidAttempt(); // SC04
        OrderLink storage link = _links[orderId];

        // SC03 - replay / duplicate protection
        if (link.status == OrderStatus.Paid) revert AlreadyFinalized(orderId);
        if (link.status != OrderStatus.None) {
            if (link.attempt == attempt) revert AlreadyLinked(orderId, attempt);
            if (attempt < link.attempt) revert InvalidAttempt();
            if (link.status == OrderStatus.AwaitingPayment) {
                PaymentOrderRegistry.Status prev = bank.getPayment(link.paymentId).status;
                if (prev != PaymentOrderRegistry.Status.Rejected && prev != PaymentOrderRegistry.Status.Cancelled) {
                    revert PreviousAttemptActive(orderId, link.attempt);
                }
            }
        }

        RetailPurchaseOrder.PurchaseOrder memory po = retail.getPO(orderId);
        if (po.status != RetailPurchaseOrder.POStatus.Approved) revert PONotApproved(orderId);

        bytes32 paymentId = paymentIdFor(orderId, attempt);
        PaymentOrderRegistry.PaymentOrder memory p = bank.getPayment(paymentId);
        // A payment may already be settled if the orchestrator crashed after registering it
        // (CP-6 recovery). Missing or cancelled (compensated) payments can never be linked.
        if (p.status == PaymentOrderRegistry.Status.None || p.status == PaymentOrderRegistry.Status.Cancelled) {
            revert PaymentNotRegistered(paymentId);
        }

        // SC04 - CP-4 cross-module consistency check
        if (p.amount != po.totalPurchaseCost) revert AmountMismatch(po.totalPurchaseCost, p.amount);
        if (p.docHash != po.poHash) revert DocHashMismatch(po.poHash, p.docHash);

        link.paymentId = paymentId;
        link.attempt = attempt;
        link.docHash = p.docHash;
        link.amount = p.amount;
        link.status = OrderStatus.AwaitingPayment;
        link.linkedAt = SafeCast.toUint64(block.timestamp);
        link.finalizedAt = 0;

        emit OrderPaymentLinked(orderId, paymentId, attempt, p.amount, p.docHash);
    }

    /// @notice Anyone may finalize: the result depends only on the modules' on-chain state.
    function finalize(bytes32 orderId) external whenNotPaused {
        OrderLink storage link = _links[orderId];
        if (link.status == OrderStatus.None) revert NotLinked(orderId);
        if (link.status != OrderStatus.AwaitingPayment) revert AlreadyFinalized(orderId);

        PaymentOrderRegistry.Status ps = bank.getPayment(link.paymentId).status;
        OrderStatus finalStatus;
        if (ps == PaymentOrderRegistry.Status.Executed) {
            finalStatus = OrderStatus.Paid;
        } else if (ps == PaymentOrderRegistry.Status.Rejected || ps == PaymentOrderRegistry.Status.Cancelled) {
            finalStatus = OrderStatus.PaymentFailed;
        } else {
            revert NotSettledYet(orderId);
        }

        link.status = finalStatus;
        link.finalizedAt = SafeCast.toUint64(block.timestamp);
        emit OrderFinalized(orderId, link.paymentId, finalStatus);
    }

    function getOrder(bytes32 orderId) external view returns (OrderLink memory) {
        return _links[orderId];
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
