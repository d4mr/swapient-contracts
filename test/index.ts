import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { Swapient } from "../typechain";

describe("Swapient", function () {
  let swapient: Swapient;
  let alice: SignerWithAddress, bob: SignerWithAddress;

  before(async () => {
    [alice, bob] = await ethers.getSigners();
  });

  describe("Unaddressed Deposits", function () {
    before(async () => {
      const Swapient = await ethers.getContractFactory("Swapient");
      swapient = await Swapient.deploy();
      await swapient.deployed();
    });

    it("Should be able to make ETH deposits", async function () {
      const depositTx = await swapient.newValueDeposit({
        value: 100,
      });

      await depositTx.wait();
      await expect(depositTx).to.emit(swapient, "DepositCreated").withArgs(0);

      const deposit = await swapient.deposits(0);

      expect(deposit.depositor).eq(alice.address);
      expect(deposit.amount).deep.eq(ethers.BigNumber.from(100));
    });
  });

  describe("Refund Unaddressed Deposits", function () {
    before(async () => {
      const Swapient = await ethers.getContractFactory("Swapient");
      swapient = await Swapient.deploy();
      await swapient.deployed();

      const depositTx = await swapient.newValueDeposit({
        value: 100,
      });

      await depositTx.wait();
    });

    it("Should fail to refund deposit for wrong user", async function () {
      const refundTx = swapient.connect(bob).refundDeposit(0);

      await expect(refundTx).to.be.revertedWith("ERR__DEPOSITOR_MISMATCH");
    });

    it("Should be able to refund deposit", async function () {
      const refundTx = swapient.refundDeposit(0);

      await expect(() => refundTx).to.changeEtherBalance(alice, 100);
      await expect(refundTx).to.emit(swapient, "DepositRefunded").withArgs(0);

      const deposit = await swapient.deposits(0);
      expect(deposit.amount).deep.eq(ethers.BigNumber.from(0));
    });

    it("Should fail to refund empty deposit", async function () {
      const refundTx = swapient.refundDeposit(0);
      await expect(refundTx).to.be.revertedWith("ERR__ZERO_AMOUNT");
    });
  });

  describe("Addressed Deposits", function () {
    before(async () => {
      const Swapient = await ethers.getContractFactory("Swapient");
      swapient = await Swapient.deploy();
      await swapient.deployed();

      const depositTx = await swapient.newValueDeposit({
        value: 100,
      });

      await depositTx.wait();
    });

    it("Should be able to add receiver (create addressed deposit)", async () => {
      const addReceiverTx = await swapient.addReceiver(
        0,
        50,
        bob.address,
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("correctpassword")),
        300,
        ""
      );

      await addReceiverTx.wait();

      await expect(addReceiverTx)
        .to.emit(swapient, "AddressedDepositCreated")
        .withArgs(0);

      const addressedDeposit = await swapient.addressedDeposits(0);

      expect(addressedDeposit.receiver).eq(bob.address);
      expect(addressedDeposit.amount).deep.equal(ethers.BigNumber.from(50));

      const deposit = await swapient.deposits(0);

      // Deposit balance should have decreased
      expect(deposit.amount).deep.equal(ethers.BigNumber.from(50));
    });

    it("Should fail to add receiver if balance is insufficient", async () => {
      const addReceiverTx = swapient.addReceiver(
        0,
        60,
        bob.address,
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("correctpassword")),
        300,
        ""
      );

      await expect(addReceiverTx).to.be.revertedWith(
        "ERR__INSUFFICIENT_AMOUNT"
      );
    });

    it("Should fail to add receiver if user is not the depositor", async () => {
      const addReceiverTx = swapient
        .connect(bob)
        .addReceiver(
          0,
          50,
          alice.address,
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes("correctpassword")),
          300,
          ""
        );

      await expect(addReceiverTx).to.be.revertedWith("ERR__DEPOSITOR_MISMATCH");
    });
  });

  describe("Refund Addressed Deposits", function () {
    before(async () => {
      const Swapient = await ethers.getContractFactory("Swapient");
      swapient = await Swapient.deploy();
      await swapient.deployed();

      const depositTx = await swapient.newValueDeposit({
        value: 100,
      });

      await depositTx.wait();

      const addReceiverTx = await swapient.addReceiver(
        0,
        50,
        bob.address,
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("correctpassword")),
        300,
        ""
      );

      await addReceiverTx.wait();
    });

    it("Should fail to refund deposit if user is not the depositor", async () => {
      const refundTx = swapient.connect(bob).refundAddressedDeposit(0);
      await expect(refundTx).to.be.revertedWith("ERR__DEPOSITOR_MISMATCH");
    });

    it("Should fail to refund deposit if not expired", async () => {
      const refundTx = swapient.refundAddressedDeposit(0);
      await expect(refundTx).to.be.revertedWith("ERR__NOT_EXPIRED");
    });

    it("Should be able refund deposit", async () => {
      await network.provider.send("evm_increaseTime", [299]);
      await network.provider.send("evm_mine");

      const refundTx = swapient.refundAddressedDeposit(0);

      await expect(() => refundTx).to.changeEtherBalance(alice, 50);
      await expect(refundTx)
        .to.emit(swapient, "AddressedDepositRefunded")
        .withArgs(0);

      const addressedDeposit = await swapient.addressedDeposits(0);
      expect(addressedDeposit.active).eq(false);
    });

    it("Should fail to refund deposit if inactive", async () => {
      const refundTx = swapient.refundAddressedDeposit(0);
      await expect(refundTx).to.be.revertedWith("ERR__INACTIVE");
    });
  });

  describe("Cancel Addressed Deposits", function () {
    before(async () => {
      const Swapient = await ethers.getContractFactory("Swapient");
      swapient = await Swapient.deploy();
      await swapient.deployed();

      const depositTx = await swapient.newValueDeposit({
        value: 100,
      });

      await depositTx.wait();

      const addReceiverTx = await swapient.addReceiver(
        0,
        50,
        bob.address,
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("correctpassword")),
        300,
        ""
      );

      await addReceiverTx.wait();
    });

    it("Should fail to cancel deposit if user is not the depositor", async () => {
      const cancelTx = swapient.connect(bob).cancelAddressedDeposit(0);
      await expect(cancelTx).to.be.revertedWith("ERR__DEPOSITOR_MISMATCH");
    });

    it("Should fail to cancel deposit if not expired", async () => {
      const cancelTx = swapient.cancelAddressedDeposit(0);
      await expect(cancelTx).to.be.revertedWith("ERR__NOT_EXPIRED");
    });

    it("Should be able cancel deposit", async () => {
      await network.provider.send("evm_increaseTime", [299]);
      await network.provider.send("evm_mine");

      const cancelTx = swapient.cancelAddressedDeposit(0);

      await expect(cancelTx)
        .to.emit(swapient, "AddressedDepositCancelled")
        .withArgs(0);

      const addressedDeposit = await swapient.addressedDeposits(0);
      expect(addressedDeposit.active).eq(false);

      const deposit = await swapient.deposits(0);
      expect(deposit.amount).to.deep.eq(ethers.BigNumber.from(100));
    });

    it("Should fail to cancel deposit if inactive", async () => {
      const cancelTx = swapient.cancelAddressedDeposit(0);
      await expect(cancelTx).to.be.revertedWith("ERR__INACTIVE");
    });
  });

  describe("Claims", function () {
    const CORRECT_PASSWORD = "correctpassword";
    const CORRECT_PASSWORD_HASH = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(CORRECT_PASSWORD)
    );

    const INCORRECT_PASSWORD = "incorrectpassword";

    beforeEach(async function () {
      const Swapient = await ethers.getContractFactory("Swapient");
      swapient = await Swapient.deploy();
      await swapient.deployed();

      const depositTx = await swapient.newValueDeposit({
        value: 100,
      });

      await depositTx.wait();

      const addReceiverTx = await swapient.addReceiver(
        0,
        50,
        bob.address,
        CORRECT_PASSWORD_HASH,
        300,
        ""
      );

      await addReceiverTx.wait();
    });

    it("Should be able to claim addressed deposit", async () => {
      const bobSwapient = swapient.connect(bob);
      const claimTx = bobSwapient.claim(0, CORRECT_PASSWORD);
      await expect(() => claimTx).to.changeEtherBalance(bob, 50);

      await expect(claimTx)
        .to.emit(bobSwapient, "AddressedDepositClaimed")
        .withArgs(0);

      const addressedDeposit = await swapient.addressedDeposits(0);
      expect(addressedDeposit.active).equal(false);
    });

    it("Should fail to claim deposit if wrong receiver", async () => {
      const claimTx = swapient.claim(0, CORRECT_PASSWORD);
      await expect(claimTx).to.be.revertedWith("ERR__RECEIVER_MISMATCH");
    });

    it("Should fail to claim deposit if wrong password", async () => {
      const claimTx = swapient.connect(bob).claim(0, INCORRECT_PASSWORD);
      await expect(claimTx).to.be.revertedWith("ERR__INCORRECT_PASSWORD");
    });

    it("Should fail to claim deposit if inactive (already claimed)", async () => {
      const bobSwapient = swapient.connect(bob);
      await (await bobSwapient.claim(0, CORRECT_PASSWORD)).wait();

      const claimTx = bobSwapient.claim(0, CORRECT_PASSWORD);
      await expect(claimTx).to.be.revertedWith("ERR__INACTIVE");
    });

    it("Should fail to claim deposit if expired", async () => {
      await network.provider.send("evm_increaseTime", [299]);
      await network.provider.send("evm_mine");

      const bobSwapient = swapient.connect(bob);
      const claimTx = bobSwapient.claim(0, CORRECT_PASSWORD);
      await expect(claimTx).to.be.revertedWith("ERR__EXPIRED");
    });
  });
});
