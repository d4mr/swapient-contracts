//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "hardhat/console.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Swapient Subatomic Swaps on native and ERC20 tokens.
 *
 * This contract provides a way to:
 *  - Deposit tokens (create a sell order, or an unadressed deposit)
 *  - Add a receiver to a portion of your deposit (add a buyer, creating an addressed deposit)
 *  - Claim an addressed deposit
 *  - Refund an unaddressed deposit
 *  - Refund an addressed deposit after
 *
 *
 * Protocol:
 *
 *  1) newValueDeposit() - a sender call to this with value creates a new unaddressed value deposit, returning a deposit ID.
 *      This represents a sell order on native tokens.
 *
 *  2) newERC20Deposit(token, value) - a sender call to this creates a new unaddressed ERC20 token deposit, returning a deposit ID.
 *      This represents a sell order on ER20 tokens.
 *
 *  3) addReceiver(depositId, value, receiver, passwordHash, validityTime, options) - adds a receiver (buyer) to a portion of your deposit, creating an addressedDeposit. Returns an ID.
 *      This has two idiomatic uses:
 *      - the buyer adds the seller as the receiver to their deposit, this creates a buy order
 *      - the seller then adds the buyer as the receiver to their deposit using the same password hash. This adds a buyer to a sell order
 *
 *  5) claim(addressedDepositId, password) - is used to claim an addressed deposit.
 *      This has two idiomatic uses:
 *      - the buyer claims the seller's addressed deposit, revealing the password in the process
 *      - the seller uses the revealed password, to claim the buyer's addressed deposit
 *
 *  6) refundAddressedDeposit(addresssedDepositId) - used to refund addressed deposit back to the depositor address after timeout.
 *
 *  7) refundDeposit(depositId) - used to refund deposit back to the depositor address. This has no timeout.
 *
 *  8) cancelAddressedDeposit(addresssedDepositId) - used to cancel addressed deposit, and send value back to the original unaddressed deposit.
 *      This works only after a timeout.
 */
contract Swapient {
    using SafeERC20 for IERC20;

    enum DepositType {
        NATIVE,
        ERC20
    }

    event DepositCreated(uint256 indexed depositId);
    event DepositRefunded(uint256 indexed depositId);
    event AddressedDepositCreated(uint256 indexed addressedDepositId);
    event AddressedDepositClaimed(uint256 indexed addressedDepositId);
    event AddressedDepositRefunded(uint256 indexed depositId);
    event AddressedDepositCancelled(uint256 indexed depositId);

    // by default deposits are unaddressed
    struct Deposit {
        address depositor;
        DepositType depositType;
        uint256 amount;
        IERC20 erc20token;
        uint256 addressedDepositCount;
    }

    struct AddressedDeposit {
        uint256 parentDepositId;
        uint256 amount;
        address receiver;
        string options;
        bytes32 passwordHash;
        uint256 expiryTime;
        bool active;
    }

    Deposit[] public deposits;
    AddressedDeposit[] public addressedDeposits;

    function newValueDeposit() external payable returns (uint256) {
        require(msg.value > 0, "ERR__NO_VALUE_SUPPLIED");
        Deposit memory newDeposit = Deposit(
            msg.sender,
            DepositType.NATIVE,
            msg.value,
            IERC20(address(0)),
            0
        );

        deposits.push(newDeposit);

        uint256 depositId = deposits.length - 1;

        emit DepositCreated(depositId);
        return depositId;
    }

    function refundDeposit(uint256 _depositId) external {
        Deposit storage deposit = deposits[_depositId];
        require(msg.sender == deposit.depositor, "ERR__DEPOSITOR_MISMATCH");
        require(deposit.amount > 0, "ERR__ZERO_AMOUNT");

        address payable depositor = payable(msg.sender);
        uint256 amount = deposit.amount;

        deposit.amount = 0;
        depositor.transfer(amount);

        emit DepositRefunded(_depositId);
    }

    function addReceiver(
        uint256 _depositId,
        uint256 _amount,
        address _receiver,
        bytes32 _passwordHash,
        uint256 _validityTime,
        string calldata _options
    ) external returns (uint256) {
        Deposit storage deposit = deposits[_depositId];

        require(deposit.depositor == msg.sender, "ERR__DEPOSITOR_MISMATCH");
        require(deposit.amount >= _amount, "ERR__INSUFFICIENT_AMOUNT");

        deposit.amount -= _amount;
        deposit.addressedDepositCount++;

        AddressedDeposit memory newAddressedDeposit = AddressedDeposit(
            _depositId,
            _amount,
            _receiver,
            _options,
            _passwordHash,
            block.timestamp + _validityTime * 1 seconds,
            true
        );

        addressedDeposits.push(newAddressedDeposit);

        uint256 addressedDepositId = addressedDeposits.length - 1;

        emit AddressedDepositCreated(addressedDepositId);
        return addressedDepositId;
    }

    function refundAddressedDeposit(uint256 _addressedDepositId) external {
        AddressedDeposit storage addressedDeposit = addressedDeposits[
            _addressedDepositId
        ];

        Deposit memory deposit = deposits[addressedDeposit.parentDepositId];

        require(deposit.depositor == msg.sender, "ERR__DEPOSITOR_MISMATCH");
        require(addressedDeposit.active, "ERR__INACTIVE");
        require(
            addressedDeposit.expiryTime < block.timestamp,
            "ERR__NOT_EXPIRED"
        );

        address payable depositor = payable(msg.sender);

        addressedDeposit.active = false;
        depositor.transfer(addressedDeposit.amount);

        emit AddressedDepositRefunded(_addressedDepositId);
    }

    function cancelAddressedDeposit(uint256 _addressedDepositId) external {
        AddressedDeposit storage addressedDeposit = addressedDeposits[
            _addressedDepositId
        ];

        Deposit storage deposit = deposits[addressedDeposit.parentDepositId];

        require(deposit.depositor == msg.sender, "ERR__DEPOSITOR_MISMATCH");
        require(addressedDeposit.active, "ERR__INACTIVE");
        require(
            addressedDeposit.expiryTime < block.timestamp,
            "ERR__NOT_EXPIRED"
        );

        deposit.amount += addressedDeposit.amount;
        addressedDeposit.active = false;

        emit AddressedDepositCancelled(_addressedDepositId);
    }

    function claim(uint256 _addressedDepositId, string calldata _password)
        external
    {
        AddressedDeposit storage addressedDeposit = addressedDeposits[
            _addressedDepositId
        ];

        require(addressedDeposit.active, "ERR__INACTIVE");
        require(addressedDeposit.expiryTime > block.timestamp, "ERR__EXPIRED");
        require(
            addressedDeposit.receiver == msg.sender,
            "ERR__RECEIVER_MISMATCH"
        );
        require(
            addressedDeposit.passwordHash ==
                keccak256(abi.encodePacked(_password)),
            "ERR__INCORRECT_PASSWORD"
        );

        addressedDeposit.active = false;

        address payable receiver = payable(msg.sender);
        receiver.transfer(addressedDeposit.amount);

        emit AddressedDepositClaimed(_addressedDepositId);
    }
}
