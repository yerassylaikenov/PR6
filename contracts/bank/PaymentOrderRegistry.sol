// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title PaymentOrderRegistry
 * @notice Реестр статусов межбанковских платёжных поручений (ПР №3, вариант 1 «Банки и финтех»).
 *         On-chain хранится только псевдонимный paymentId, keccak256-хеш документа, сумма,
 *         статус, адреса ролей и время. Оригинал поручения и персональные/банковские данные
 *         (ФИО, ИИН/БИН, IBAN, назначение платежа, номер операции) хранятся off-chain в АБС банка.
 *
 * @dev Роли (OpenZeppelin AccessControl, проверка строго по msg.sender, tx.origin не используется):
 *      - DEFAULT_ADMIN_ROLE — управление ролями, pause/unpause (не имеет операционных ролей);
 *      - OPERATOR_ROLE      — оператор банка-отправителя: registerPayment, cancelPayment;
 *      - SETTLEMENT_ROLE    — расчётный (клиринговый) центр: markExecuted, markRejected;
 *      - аудитор / банк-получатель — без роли, только view-функции.
 *
 *      Автомат статусов: None -> Registered -> {Executed | Rejected | Cancelled}.
 *      Executed / Rejected / Cancelled — финальные, необратимые; paymentId не переиспользуется.
 *
 *      OWASP Smart Contract Top 10 (2025):
 *      - SC05:2025 Reentrancy / SC06:2025 Unchecked External Calls — не применимы: контракт не
 *        переводит ETH/токены, не делает call/delegatecall/send/transfer и не вызывает внешние
 *        контракты; нет receive/fallback. Все функции записи следуют схеме CEI
 *        (проверки -> изменение состояния -> событие), поэтому ReentrancyGuard не нужен:
 *        поверхности атаки повторного входа нет.
 *      - SC07:2025 Flash Loan Attacks — не применимо: нет балансов, ликвидности и цен.
 *      - SC02:2025 Price Oracle Manipulation — не применимо: нет оракулов.
 *      - SC09:2025 Insecure Randomness — не применимо on-chain: соль для paymentId генерируется
 *        off-chain криптостойким генератором (CSPRNG).
 *      - SC10:2025 Denial of Service — в контракте нет циклов по массивам (mapping, O(1)) и
 *        внешних вызовов; аварийная пауза доступна только DEFAULT_ADMIN_ROLE.
 */
contract PaymentOrderRegistry is AccessControl, Pausable {
    /// @notice Роль оператора банка-отправителя.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @notice Роль расчётного (клирингового) центра.
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");

    /// @notice Статусы платёжного поручения (конечный автомат).
    enum Status {
        None,
        Registered,
        Executed,
        Rejected,
        Cancelled
    }

    /// @notice Минимальный on-chain набор данных по поручению.
    struct PaymentOrder {
        bytes32 docHash; // keccak256 канонического документа (оригинал — off-chain)
        uint128 amount; // сумма в минимальных единицах (тиын), > 0
        uint64 registeredAt;
        uint64 updatedAt;
        Status status;
        address registeredBy; // оператор-инициатор
        address settledBy; // расчётный центр (0 до исполнения/отклонения)
    }

    /// @dev Ключ — псевдонимный paymentId = keccak256(abi.encode(senderBic, operationRef, valueDate, salt)).
    mapping(bytes32 => PaymentOrder) private _payments;

    /// @notice Количество успешно зарегистрированных поручений.
    uint256 public totalRegistered;

    /// @notice Поручение зарегистрировано оператором.
    event PaymentRegistered(bytes32 indexed paymentId, bytes32 docHash, uint128 amount, address indexed operator);

    /// @notice Статус поручения изменён.
    event PaymentStatusChanged(
        bytes32 indexed paymentId, Status from, Status to, address indexed actor, bytes32 reasonCode
    );

    error ZeroAddress();
    error InvalidPaymentId();
    error InvalidDocHash();
    error InvalidAmount();
    error InvalidReasonCode();
    error PaymentAlreadyExists(bytes32 paymentId);
    error PaymentNotFound(bytes32 paymentId);
    error InvalidStatusTransition(Status from, Status to);
    error NotPaymentInitiator(address caller);
    error SelfSettlementForbidden(address caller);

    /**
     * @notice Развёртывание реестра.
     * @param admin Адрес администратора (в продакшене — Safe multisig 2/3 + timelock).
     */
    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /**
     * @notice Регистрирует новое платёжное поручение.
     * @dev Только OPERATOR_ROLE, не на паузе. Персональные данные не принимаются — только хеш.
     * @param paymentId Псевдонимный идентификатор поручения (≠ 0, уникальный навсегда).
     * @param docHash keccak256 канонического документа поручения (≠ 0).
     * @param amount Сумма в тиынах (> 0).
     */
    function registerPayment(bytes32 paymentId, bytes32 docHash, uint128 amount)
        external
        onlyRole(OPERATOR_ROLE) // OWASP SC01:2025 — role check by msg.sender
        whenNotPaused
    {
        // OWASP SC04:2025 — input validation
        if (paymentId == bytes32(0)) revert InvalidPaymentId();
        if (docHash == bytes32(0)) revert InvalidDocHash();
        if (amount == 0) revert InvalidAmount();
        PaymentOrder storage p = _payments[paymentId];
        // OWASP SC03:2025 — state machine: paymentId is never reused (even after Cancelled)
        if (p.status != Status.None) revert PaymentAlreadyExists(paymentId);

        // OWASP SC08:2025 — SafeCast
        uint64 nowTs = SafeCast.toUint64(block.timestamp);
        p.docHash = docHash;
        p.amount = amount;
        p.registeredAt = nowTs;
        p.updatedAt = nowTs;
        p.status = Status.Registered;
        p.registeredBy = msg.sender;
        totalRegistered += 1;

        emit PaymentRegistered(paymentId, docHash, amount, msg.sender);
    }

    /**
     * @notice Отзывает поручение (только инициатор, только из статуса Registered).
     * @dev Только OPERATOR_ROLE, не на паузе.
     * @param paymentId Идентификатор поручения.
     */
    function cancelPayment(bytes32 paymentId)
        external
        onlyRole(OPERATOR_ROLE) // OWASP SC01:2025 — role check by msg.sender
        whenNotPaused
    {
        PaymentOrder storage p = _payments[paymentId];
        Status current = p.status;
        // OWASP SC04:2025 — input validation
        if (current == Status.None) revert PaymentNotFound(paymentId);
        // OWASP SC03:2025 — state machine
        if (current != Status.Registered) revert InvalidStatusTransition(current, Status.Cancelled);
        // OWASP SC01:2025 — only the initiating operator may cancel
        if (p.registeredBy != msg.sender) revert NotPaymentInitiator(msg.sender);

        p.status = Status.Cancelled;
        p.updatedAt = SafeCast.toUint64(block.timestamp); // OWASP SC08:2025 — SafeCast

        emit PaymentStatusChanged(paymentId, Status.Registered, Status.Cancelled, msg.sender, bytes32(0));
    }

    /**
     * @notice Расчётный центр подтверждает исполнение поручения.
     * @dev Только SETTLEMENT_ROLE, не на паузе. Принцип «4 глаз»: исполнитель ≠ инициатор.
     * @param paymentId Идентификатор поручения.
     */
    function markExecuted(bytes32 paymentId)
        external
        onlyRole(SETTLEMENT_ROLE) // OWASP SC01:2025 — role check by msg.sender
        whenNotPaused
    {
        PaymentOrder storage p = _payments[paymentId];
        Status current = p.status;
        // OWASP SC04:2025 — input validation
        if (current == Status.None) revert PaymentNotFound(paymentId);
        // OWASP SC03:2025 — state machine
        if (current != Status.Registered) revert InvalidStatusTransition(current, Status.Executed);
        // OWASP SC01:2025 — four-eyes principle (segregation of duties)
        if (p.registeredBy == msg.sender) revert SelfSettlementForbidden(msg.sender);

        p.status = Status.Executed;
        p.settledBy = msg.sender;
        p.updatedAt = SafeCast.toUint64(block.timestamp); // OWASP SC08:2025 — SafeCast

        emit PaymentStatusChanged(paymentId, Status.Registered, Status.Executed, msg.sender, bytes32(0));
    }

    /**
     * @notice Расчётный центр отклоняет поручение с кодом причины.
     * @dev Только SETTLEMENT_ROLE, не на паузе. Принцип «4 глаз»: исполнитель ≠ инициатор.
     * @param paymentId Идентификатор поручения.
     * @param reasonCode Код причины отклонения ISO 20022 (например, "AC04"), ≠ 0.
     */
    function markRejected(bytes32 paymentId, bytes32 reasonCode)
        external
        onlyRole(SETTLEMENT_ROLE) // OWASP SC01:2025 — role check by msg.sender
        whenNotPaused
    {
        // OWASP SC04:2025 — input validation
        if (reasonCode == bytes32(0)) revert InvalidReasonCode();
        PaymentOrder storage p = _payments[paymentId];
        Status current = p.status;
        if (current == Status.None) revert PaymentNotFound(paymentId);
        // OWASP SC03:2025 — state machine
        if (current != Status.Registered) revert InvalidStatusTransition(current, Status.Rejected);
        // OWASP SC01:2025 — four-eyes principle (segregation of duties)
        if (p.registeredBy == msg.sender) revert SelfSettlementForbidden(msg.sender);

        p.status = Status.Rejected;
        p.settledBy = msg.sender;
        p.updatedAt = SafeCast.toUint64(block.timestamp); // OWASP SC08:2025 — SafeCast

        emit PaymentStatusChanged(paymentId, Status.Registered, Status.Rejected, msg.sender, reasonCode);
    }

    /**
     * @notice Аварийная остановка всех операций записи.
     * @dev Только DEFAULT_ADMIN_ROLE. OWASP SC10:2025 — пауза доступна только администратору.
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Снятие аварийной остановки.
     * @dev Только DEFAULT_ADMIN_ROLE.
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Возвращает данные поручения (для несуществующего — нулевая структура).
     * @param paymentId Идентификатор поручения.
     * @return Данные поручения.
     */
    function getPayment(bytes32 paymentId) external view returns (PaymentOrder memory) {
        return _payments[paymentId];
    }

    /**
     * @notice Проверяет, что документ не был изменён: сравнивает хеш с зарегистрированным.
     * @param paymentId Идентификатор поручения.
     * @param candidateHash keccak256 полученного документа.
     * @return true, если поручение существует и хеш совпадает.
     */
    function verifyDocument(bytes32 paymentId, bytes32 candidateHash) external view returns (bool) {
        PaymentOrder storage p = _payments[paymentId];
        return p.status != Status.None && candidateHash != bytes32(0) && p.docHash == candidateHash;
    }
}
