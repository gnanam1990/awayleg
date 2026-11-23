// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AwayLegSeason} from "../src/AwayLegSeason.sol";
import {TestRegistry} from "../src/TestRegistry.sol";

contract AwayLegSeasonTest is Test {
    address constant ORGANIZER = address(0x0A11CE);
    address constant HOME_CAPTAIN = address(0xC0A1);
    address constant AWAY_CAPTAIN = address(0xC0A2);
    address constant HOME_ENTRANT = address(0xE101);
    address constant AWAY_ENTRANT = address(0xE202);
    bytes32 constant COURSE_HASH =
        0x3de7c3c6dfc61070fbaa0fc30ef3bbd01741ccb7a31492fa72bcf9ad9cbb5c95;
    bytes32 constant REPLAY_HASH =
        0x5bc5556fe729bd9809d6e2b772870009b11441e5c7a50bc5295d4640ce53e5ac;

    TestRegistry registry;
    AwayLegSeason season;
    uint64 entryClose;
    uint64 attestClose;

    function setUp() public {
        vm.warp(1_700_000_000);
        registry = new TestRegistry();
        season = new AwayLegSeason(ORGANIZER, address(registry), HOME_CAPTAIN, AWAY_CAPTAIN);
        entryClose = uint64(block.timestamp + 100);
        attestClose = uint64(block.timestamp + 200);
        registry.setBalance(HOME_ENTRANT, 1);
        registry.setBalance(AWAY_ENTRANT, 1);
    }

    function _create() internal returns (uint64 id) {
        vm.prank(ORGANIZER);
        id = season.createFixture(
            keccak256("fixture-1"), HOME_ENTRANT, AWAY_ENTRANT, COURSE_HASH, entryClose, attestClose
        );
    }

    function _createAndLock() internal returns (uint64 id) {
        id = _create();
        vm.prank(HOME_ENTRANT);
        season.lockStrategy(id, [0, 1, 2, 3, 4]);
        vm.prank(AWAY_ENTRANT);
        season.lockStrategy(id, [4, 3, 2, 1, 0]);
    }

    // ---------- T-004 entry permissions and deadline ----------

    function test_holder_locks() public {
        uint64 id = _create();
        vm.prank(HOME_ENTRANT);
        season.lockStrategy(id, [0, 1, 2, 3, 4]);
        AwayLegSeason.Fixture memory f = season.fixture(id);
        assertTrue(f.homeLocked);
        assertEq(f.homeOrder[0], 0);
    }

    function test_nonHolder_reverts() public {
        uint64 id = _create();
        registry.setBalance(HOME_ENTRANT, 0);
        vm.prank(HOME_ENTRANT);
        vm.expectRevert(AwayLegSeason.NotHolder.selector);
        season.lockStrategy(id, [0, 1, 2, 3, 4]);
    }

    function test_wrongEntrant_reverts() public {
        uint64 id = _create();
        address rando = address(0xBEEF);
        registry.setBalance(rando, 5);
        vm.prank(rando);
        vm.expectRevert(AwayLegSeason.NotEntrant.selector);
        season.lockStrategy(id, [0, 1, 2, 3, 4]);
    }

    function test_reusedSlot_reverts() public {
        uint64 id = _create();
        vm.startPrank(HOME_ENTRANT);
        season.lockStrategy(id, [0, 1, 2, 3, 4]);
        vm.expectRevert(AwayLegSeason.SlotFilled.selector);
        season.lockStrategy(id, [1, 0, 2, 3, 4]);
        vm.stopPrank();
    }

    function test_badPermutation_reverts() public {
        uint64 id = _create();
        vm.startPrank(HOME_ENTRANT);
        vm.expectRevert(AwayLegSeason.BadPermutation.selector);
        season.lockStrategy(id, [0, 0, 1, 2, 3]);
        vm.expectRevert(AwayLegSeason.BadPermutation.selector);
        season.lockStrategy(id, [0, 1, 2, 3, 5]);
        vm.stopPrank();
    }

    function test_failedRegistryRead_propagates() public {
        uint64 id = _create();
        registry.setFailReads(true);
        vm.prank(HOME_ENTRANT);
        vm.expectRevert("registry read failed");
        season.lockStrategy(id, [0, 1, 2, 3, 4]);
    }

    function test_entryAtExactClose_reverts() public {
        uint64 id = _create();
        vm.warp(entryClose); // mine exactly at entryClose
        vm.prank(HOME_ENTRANT);
        vm.expectRevert(AwayLegSeason.EntryClosed.selector);
        season.lockStrategy(id, [0, 1, 2, 3, 4]);
    }

    function test_entryAfterClose_reverts() public {
        uint64 id = _create();
        vm.warp(entryClose + 1);
        vm.prank(HOME_ENTRANT);
        vm.expectRevert(AwayLegSeason.EntryClosed.selector);
        season.lockStrategy(id, [0, 1, 2, 3, 4]);
    }

    // ---------- T-005 referee settlement ----------

    function test_scheduleKeyRecoversFixture() public {
        // Simulate a dropped create response: caller re-queries by key.
        uint64 id = _create();
        bytes32 key = keccak256("fixture-1");
        assertEq(season.fixtureIdByScheduleKey(key), id);
        // Reusing the key reverts — a single fixture exists.
        vm.prank(ORGANIZER);
        vm.expectRevert(AwayLegSeason.ScheduleKeyUsed.selector);
        season.createFixture(key, HOME_ENTRANT, AWAY_ENTRANT, COURSE_HASH, entryClose, attestClose);
        assertEq(season.fixtureCount(), 1);
    }

    function test_twoMatchingTuples_accept() public {
        uint64 id = _createAndLock();
        vm.warp(entryClose + 1);
        vm.prank(HOME_CAPTAIN);
        season.attest(id, REPLAY_HASH, 5, 5, 5, 9);
        vm.prank(AWAY_CAPTAIN);
        season.attest(id, REPLAY_HASH, 5, 5, 5, 9);
        assertEq(uint8(season.fixture(id).state), uint8(AwayLegSeason.State.Accepted));
        assertEq(uint8(season.fixture(id).outcome), uint8(AwayLegSeason.Outcome.HomeWin));
    }

    function test_mismatchedTuples_dispute() public {
        uint64 id = _createAndLock();
        vm.warp(entryClose + 1);
        vm.prank(HOME_CAPTAIN);
        season.attest(id, REPLAY_HASH, 5, 5, 5, 9);
        // Same hash but different score summary.
        vm.prank(AWAY_CAPTAIN);
        season.attest(id, REPLAY_HASH, 5, 5, 4, 9);
        assertEq(uint8(season.fixture(id).state), uint8(AwayLegSeason.State.Disputed));
    }

    function test_differentHashes_dispute() public {
        uint64 id = _createAndLock();
        vm.warp(entryClose + 1);
        vm.prank(HOME_CAPTAIN);
        season.attest(id, REPLAY_HASH, 5, 5, 5, 9);
        vm.prank(AWAY_CAPTAIN);
        season.attest(id, bytes32(uint256(1)), 5, 5, 5, 9);
        assertEq(uint8(season.fixture(id).state), uint8(AwayLegSeason.State.Disputed));
    }

    function test_attestTooEarly_reverts() public {
        uint64 id = _createAndLock();
        vm.warp(entryClose - 1); // still inside entry window
        vm.prank(HOME_CAPTAIN);
        vm.expectRevert(AwayLegSeason.AttestWindow.selector);
        season.attest(id, REPLAY_HASH, 5, 5, 5, 9);
    }

    function test_attestTooLate_reverts() public {
        uint64 id = _createAndLock();
        vm.warp(attestClose);
        vm.prank(HOME_CAPTAIN);
        vm.expectRevert(AwayLegSeason.AttestWindow.selector);
        season.attest(id, REPLAY_HASH, 5, 5, 5, 9);
    }

    function test_duplicateCaptainReport_reverts() public {
        uint64 id = _createAndLock();
        vm.warp(entryClose + 1);
        vm.startPrank(HOME_CAPTAIN);
        season.attest(id, REPLAY_HASH, 5, 5, 5, 9);
        vm.expectRevert(AwayLegSeason.AlreadyReported.selector);
        season.attest(id, REPLAY_HASH, 5, 5, 5, 9);
        vm.stopPrank();
    }

    function test_nonCaptainAttest_reverts() public {
        uint64 id = _createAndLock();
        vm.warp(entryClose + 1);
        vm.prank(ORGANIZER);
        vm.expectRevert(AwayLegSeason.NotCaptain.selector);
        season.attest(id, REPLAY_HASH, 5, 5, 5, 9);
        vm.prank(HOME_ENTRANT);
        vm.expectRevert(AwayLegSeason.NotCaptain.selector);
        season.attest(id, REPLAY_HASH, 5, 5, 5, 9);
    }

    function test_unknownScoreRanges_revert() public {
        uint64 id = _createAndLock();
        vm.warp(entryClose + 1);
        vm.startPrank(HOME_CAPTAIN);
        vm.expectRevert(AwayLegSeason.BadTuple.selector);
        season.attest(id, REPLAY_HASH, 6, 5, 5, 9); // delivered > 5
        vm.expectRevert(AwayLegSeason.BadTuple.selector);
        season.attest(id, REPLAY_HASH, 5, 31, 5, 9); // turns > 30
        vm.expectRevert(AwayLegSeason.BadTuple.selector);
        season.attest(id, REPLAY_HASH, 5, 4, 5, 9); // turns < delivered
        vm.stopPrank();
    }

    function test_writesOnUncreatedFixture_revert() public {
        vm.expectRevert(AwayLegSeason.NoSuchFixture.selector);
        season.lockStrategy(99, [0, 1, 2, 3, 4]);
        vm.expectRevert(AwayLegSeason.NoSuchFixture.selector);
        season.attest(99, REPLAY_HASH, 5, 5, 5, 9);
        vm.warp(attestClose + 1);
        vm.expectRevert(AwayLegSeason.NoSuchFixture.selector);
        season.expire(99);
    }

    function test_fixtureCaptainsAreSeasonBound() public {
        uint64 id = _create();
        AwayLegSeason.Fixture memory f = season.fixture(id);
        // Fixture carries no per-fixture captain fields: the two fixed season
        // captains sign every report.
        assertEq(season.homeCaptain(), HOME_CAPTAIN);
        assertEq(season.awayCaptain(), AWAY_CAPTAIN);
        vm.warp(entryClose + 1);
        vm.prank(address(0xC0A3)); // a third "captain" can never attest
        vm.expectRevert(AwayLegSeason.NotCaptain.selector);
        season.attest(id, REPLAY_HASH, 5, 5, 5, 9);
    }

    function test_onlyOrganizerSchedules() public {
        vm.prank(HOME_ENTRANT);
        vm.expectRevert(AwayLegSeason.NotOrganizer.selector);
        season.createFixture(
            keccak256("x"), HOME_ENTRANT, AWAY_ENTRANT, COURSE_HASH, entryClose, attestClose
        );
    }

    function test_createFixtureValidation() public {
        vm.startPrank(ORGANIZER);
        vm.expectRevert(AwayLegSeason.BadScheduleKey.selector);
        season.createFixture(bytes32(0), HOME_ENTRANT, AWAY_ENTRANT, COURSE_HASH, entryClose, attestClose);
        vm.expectRevert(AwayLegSeason.BadAddresses.selector);
        season.createFixture(
            keccak256("a"), HOME_ENTRANT, HOME_ENTRANT, COURSE_HASH, entryClose, attestClose
        );
        vm.expectRevert(AwayLegSeason.BadAddresses.selector);
        season.createFixture(
            keccak256("b"), HOME_CAPTAIN, AWAY_ENTRANT, COURSE_HASH, entryClose, attestClose
        );
        vm.expectRevert(AwayLegSeason.BadCourseHash.selector);
        season.createFixture(
            keccak256("c"), HOME_ENTRANT, AWAY_ENTRANT, bytes32(0), entryClose, attestClose
        );
        vm.expectRevert(AwayLegSeason.BadTimes.selector);
        season.createFixture(
            keccak256("d"), HOME_ENTRANT, AWAY_ENTRANT, COURSE_HASH, uint64(block.timestamp), attestClose
        );
        vm.expectRevert(AwayLegSeason.BadTimes.selector);
        season.createFixture(
            keccak256("e"), HOME_ENTRANT, AWAY_ENTRANT, COURSE_HASH, attestClose, entryClose
        );
        vm.stopPrank();
    }

    // ---------- T-006 unfilled and expired slots ----------

    function test_missingLockBlocksAttestation() public {
        uint64 id = _create();
        vm.prank(HOME_ENTRANT);
        season.lockStrategy(id, [0, 1, 2, 3, 4]); // only home locks
        vm.warp(entryClose + 1);
        vm.prank(HOME_CAPTAIN);
        vm.expectRevert(AwayLegSeason.EntriesMissing.selector);
        season.attest(id, REPLAY_HASH, 5, 5, 5, 9);
    }

    function test_permissionlessExpiryFinalizesOnce() public {
        uint64 id = _createAndLock();
        vm.warp(entryClose + 1);
        vm.prank(HOME_CAPTAIN);
        season.attest(id, REPLAY_HASH, 5, 5, 5, 9); // one report, awaiting away
        vm.warp(attestClose + 1);
        vm.prank(address(0xDEAD)); // anyone may expire
        season.expire(id);
        assertEq(uint8(season.fixture(id).state), uint8(AwayLegSeason.State.Expired));
        vm.expectRevert(AwayLegSeason.Terminal.selector);
        season.expire(id);
        // No late attestations after expiry.
        vm.prank(AWAY_CAPTAIN);
        vm.expectRevert(AwayLegSeason.Terminal.selector);
        season.attest(id, REPLAY_HASH, 5, 5, 5, 9);
    }

    function test_expireBeforeClose_reverts() public {
        uint64 id = _create();
        vm.expectRevert(AwayLegSeason.NotExpired.selector);
        season.expire(id);
    }

    function test_neverLockedExpires() public {
        uint64 id = _create();
        vm.warp(attestClose + 1);
        season.expire(id);
        assertEq(uint8(season.fixture(id).state), uint8(AwayLegSeason.State.Expired));
    }

    function test_drawOutcome() public {
        uint64 id = _createAndLock();
        vm.warp(entryClose + 1);
        vm.prank(HOME_CAPTAIN);
        season.attest(id, REPLAY_HASH, 5, 9, 5, 9);
        vm.prank(AWAY_CAPTAIN);
        season.attest(id, REPLAY_HASH, 5, 9, 5, 9);
        assertEq(uint8(season.fixture(id).outcome), uint8(AwayLegSeason.Outcome.Draw));
    }
}
