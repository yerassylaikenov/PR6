// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title RetailPurchaseOrder (Module B - topic 10 "Retail")
 * @notice Registry of purchase orders (PO) between a retailer (store) and a supplier.
 *         On-chain: only poId, parties, poHash (keccak256 of the canonical PO JSON),
 *         total purchase cost (tiyn) and status. Items/prices live off-chain (data/orders).
 * @dev Roles: RETAILER_ROLE creates/cancels its own POs; SUPPLIER_ROLE approves POs
 *      addressed to it. Status: None -> Created -> {Approved | Cancelled}.
 *      OWASP SC Top 10 (2025): SC01 access control by msg.sender (no tx.origin),
 *      SC03 strict state machine, SC04 input validation, SC08 SafeCast,
 *      SC05/SC06/SC07 not applicable (no value transfer, no external calls).
 */
contract RetailPurchaseOrder is AccessControl {
    bytes32 public constant RETAILER_ROLE = keccak256("RETAILER_ROLE");
    bytes32 public constant SUPPLIER_ROLE = keccak256("SUPPLIER_ROLE");

    enum POStatus {
        None,
        Created,
        Approved,
        Cancelled
    }

    struct PurchaseOrder {
        address retailer;
        address supplier;
        bytes32 poHash;
        uint128 totalPurchaseCost; // tiyn (1 KZT = 100 tiyn)
        uint32 itemCount;
        POStatus status;
        uint64 createdAt;
        uint64 updatedAt;
    }

    mapping(bytes32 => PurchaseOrder) private _orders;
    bytes32[] private _orderIds;

    event PurchaseOrderCreated(
        bytes32 indexed poId, address indexed retailer, address indexed supplier, bytes32 poHash, uint128 totalPurchaseCost
    );
    event PurchaseOrderApproved(bytes32 indexed poId, address indexed supplier);
    event PurchaseOrderCancelled(bytes32 indexed poId, address indexed retailer);

    error ZeroAddress();
    error InvalidPoId();
    error InvalidPoHash();
    error InvalidAmount();
    error InvalidSupplier(address supplier);
    error PurchaseOrderExists(bytes32 poId);
    error PurchaseOrderNotFound(bytes32 poId);
    error InvalidPOStatus(POStatus current);
    error NotOrderSupplier(address caller);
    error NotOrderRetailer(address caller);

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Retailer creates a PO. poId = keccak256(utf8("PO-2026-NNNNNN")).
    function createPO(bytes32 poId, address supplier, bytes32 poHash, uint128 totalPurchaseCost, uint32 itemCount)
        external
        onlyRole(RETAILER_ROLE) // SC01
    {
        // SC04 - input validation
        if (poId == bytes32(0)) revert InvalidPoId();
        if (poHash == bytes32(0)) revert InvalidPoHash();
        if (totalPurchaseCost == 0 || itemCount == 0) revert InvalidAmount();
        if (!hasRole(SUPPLIER_ROLE, supplier)) revert InvalidSupplier(supplier);
        PurchaseOrder storage po = _orders[poId];
        if (po.status != POStatus.None) revert PurchaseOrderExists(poId); // SC03 - no reuse

        uint64 nowTs = SafeCast.toUint64(block.timestamp); // SC08
        po.retailer = msg.sender;
        po.supplier = supplier;
        po.poHash = poHash;
        po.totalPurchaseCost = totalPurchaseCost;
        po.itemCount = itemCount;
        po.status = POStatus.Created;
        po.createdAt = nowTs;
        po.updatedAt = nowTs;
        _orderIds.push(poId);

        emit PurchaseOrderCreated(poId, msg.sender, supplier, poHash, totalPurchaseCost);
    }

    /// @notice The addressed supplier approves the PO (price and composition confirmed).
    function approvePO(bytes32 poId) external onlyRole(SUPPLIER_ROLE) {
        PurchaseOrder storage po = _orders[poId];
        if (po.status == POStatus.None) revert PurchaseOrderNotFound(poId);
        if (po.status != POStatus.Created) revert InvalidPOStatus(po.status); // SC03
        if (po.supplier != msg.sender) revert NotOrderSupplier(msg.sender); // SC01
        po.status = POStatus.Approved;
        po.updatedAt = SafeCast.toUint64(block.timestamp);
        emit PurchaseOrderApproved(poId, msg.sender);
    }

    /// @notice The retailer cancels its own PO while it is still Created.
    function cancelPO(bytes32 poId) external onlyRole(RETAILER_ROLE) {
        PurchaseOrder storage po = _orders[poId];
        if (po.status == POStatus.None) revert PurchaseOrderNotFound(poId);
        if (po.status != POStatus.Created) revert InvalidPOStatus(po.status); // SC03
        if (po.retailer != msg.sender) revert NotOrderRetailer(msg.sender); // SC01
        po.status = POStatus.Cancelled;
        po.updatedAt = SafeCast.toUint64(block.timestamp);
        emit PurchaseOrderCancelled(poId, msg.sender);
    }

    function getPO(bytes32 poId) external view returns (PurchaseOrder memory) {
        return _orders[poId];
    }

    function orderCount() external view returns (uint256) {
        return _orderIds.length;
    }

    function orderIdAt(uint256 index) external view returns (bytes32) {
        return _orderIds[index];
    }
}
