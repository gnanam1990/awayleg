// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal holder registry read (Agent ID registry exposes balanceOf).
interface IAgentRegistry {
    function balanceOf(address owner) external view returns (uint256);
}

/// @title AwayLegSeason — one two-club season of courier fixtures.
/// @dev Non-upgradeable. Constructor freezes organizer, holder registry and the
/// two club captain wallets for the whole deployment. Fixtures carry two
/// entrant slots and reuse the deployment captains; no per-fixture captain
/// substitution is possible.
///
/// Write surface (all nonpayable):
///   createFixture — organizer only, immutable schedule, sequential id
///   lockStrategy  — scheduled entrant, one immutable permutation per slot
///   attest        — fixed captain, bounded score tuple after entry close
///   expire        — permissionless, finalizes an unresolved fixture once
///
/// The contract holds no player assets, uses no approvals and accepts no
/// native value. Points are derived offchain from finalized events.
contract AwayLegSeason {
    enum State {
        Open,
        Accepted,
        Disputed,
        Expired
    }
    enum Outcome {
        None,
        HomeWin,
        AwayWin,
        Draw
    }

    struct Tuple {
        bytes32 replayHash;
        uint8 homeDelivered;
        uint8 homeTurns;
        uint8 awayDelivered;
        uint8 awayTurns;
    }

    struct Fixture {
        uint64 entryClose;
        uint64 attestClose;
        bytes32 scheduleKey;
        bytes32 courseHash;
        address homeEntrant;
        address awayEntrant;
        State state;
        Outcome outcome;
        uint8[5] homeOrder;
        uint8[5] awayOrder;
        bool homeLocked;
        bool awayLocked;
        Tuple homeReport;
        Tuple awayReport;
        bool homeReported;
        bool awayReported;
    }

    uint64 public constant MAX_DELIVERED = 5;
    uint64 public constant MAX_TURNS = 30;

    address public immutable organizer;
    IAgentRegistry public immutable registry;
    address public immutable homeCaptain;
    address public immutable awayCaptain;

    uint64 public fixtureCount;
    mapping(uint64 => Fixture) private fixtures;
    mapping(bytes32 => uint64) public fixtureIdByScheduleKey;

    event FixtureCreated(
        uint64 indexed id,
        bytes32 indexed scheduleKey,
        address indexed homeEntrant,
        address awayEntrant,
        address homeCaptain,
        address awayCaptain,
        bytes32 courseHash,
        uint64 entryClose,
        uint64 attestClose
    );
    event StrategyLocked(
        uint64 indexed id,
        uint8 indexed slot,
        address indexed entrant,
        uint8[5] order
    );
    event Attested(
        uint64 indexed id,
        address indexed captain,
        bytes32 replayHash,
        uint8 homeDelivered,
        uint8 homeTurns,
        uint8 awayDelivered,
        uint8 awayTurns
    );
    event Accepted(
        uint64 indexed id,
        Outcome outcome,
        bytes32 replayHash,
        uint8 homeDelivered,
        uint8 homeTurns,
        uint8 awayDelivered,
        uint8 awayTurns
    );
    event Disputed(uint64 indexed id, Tuple homeReport, Tuple awayReport);
    event Expired(uint64 indexed id);

    error NotOrganizer();
    error BadScheduleKey();
    error ScheduleKeyUsed();
    error BadAddresses();
    error BadTimes();
    error BadCourseHash();
    error NoSuchFixture();
    error NotEntrant();
    error SlotFilled();
    error NotHolder();
    error EntryClosed();
    error BadPermutation();
    error NotCaptain();
    error EntriesMissing();
    error AttestWindow();
    error AlreadyReported();
    error Terminal();
    error BadTuple();
    error NotExpired();

    modifier onlyOrganizer() {
        if (msg.sender != organizer) revert NotOrganizer();
        _;
    }

    constructor(address organizer_, address registry_, address homeCaptain_, address awayCaptain_) {
        if (
            organizer_ == address(0) || registry_ == address(0) || homeCaptain_ == address(0)
                || awayCaptain_ == address(0) || homeCaptain_ == awayCaptain_
        ) revert BadAddresses();
        organizer = organizer_;
        registry = IAgentRegistry(registry_);
        homeCaptain = homeCaptain_;
        awayCaptain = awayCaptain_;
    }

    /// @notice Book one entrant from each club on an immutable course.
    /// @param scheduleKey caller-chosen nonzero key for retry reconciliation.
    ///        Reusing a committed key reverts; the stored mapping recovers the id.
    function createFixture(
        bytes32 scheduleKey,
        address home,
        address away,
        bytes32 courseHash,
        uint64 entryClose,
        uint64 attestClose
    ) external onlyOrganizer returns (uint64 id) {
        if (scheduleKey == bytes32(0)) revert BadScheduleKey();
        if (fixtureIdByScheduleKey[scheduleKey] != 0) revert ScheduleKeyUsed();
        if (
            home == address(0) || away == address(0) || home == away || home == homeCaptain
                || home == awayCaptain || away == homeCaptain || away == awayCaptain
        ) revert BadAddresses();
        if (courseHash == bytes32(0)) revert BadCourseHash();
        if (block.timestamp >= entryClose || entryClose >= attestClose) revert BadTimes();

        id = ++fixtureCount;
        Fixture storage f = fixtures[id];
        f.scheduleKey = scheduleKey;
        f.courseHash = courseHash;
        f.homeEntrant = home;
        f.awayEntrant = away;
        f.entryClose = entryClose;
        f.attestClose = attestClose;
        fixtureIdByScheduleKey[scheduleKey] = id;

        emit FixtureCreated(
            id, scheduleKey, home, away, homeCaptain, awayCaptain, courseHash, entryClose,
            attestClose
        );
    }

    /// @notice The scheduled holder locks exactly one public permutation.
    /// First write wins; the slot is immutable afterwards.
    function lockStrategy(uint64 id, uint8[5] calldata order) external {
        Fixture storage f = _fixture(id);
        if (block.timestamp >= f.entryClose) revert EntryClosed();
        uint8 slot;
        if (msg.sender == f.homeEntrant) slot = 0;
        else if (msg.sender == f.awayEntrant) slot = 1;
        else revert NotEntrant();
        if (slot == 0 ? f.homeLocked : f.awayLocked) revert SlotFilled();
        if (registry.balanceOf(msg.sender) == 0) revert NotHolder();
        if (!_isPermutation(order)) revert BadPermutation();
        if (slot == 0) {
            f.homeLocked = true;
            f.homeOrder = order;
        } else {
            f.awayLocked = true;
            f.awayOrder = order;
        }
        emit StrategyLocked(id, slot, msg.sender, order);
    }

    /// @notice A fixed season captain reports the replay tuple it computed.
    /// Two exactly matching on-time tuples accept the fixture; a mismatch on
    /// any of the five fields disputes it. Each captain reports once.
    function attest(
        uint64 id,
        bytes32 replayHash,
        uint8 homeDelivered,
        uint8 homeTurns,
        uint8 awayDelivered,
        uint8 awayTurns
    ) external {
        Fixture storage f = _fixture(id);
        if (f.state != State.Open) revert Terminal();
        if (msg.sender == homeCaptain) {
            if (f.homeReported) revert AlreadyReported();
        } else if (msg.sender == awayCaptain) {
            if (f.awayReported) revert AlreadyReported();
        } else {
            revert NotCaptain();
        }
        if (!f.homeLocked || !f.awayLocked) revert EntriesMissing();
        if (block.timestamp < f.entryClose || block.timestamp >= f.attestClose) {
            revert AttestWindow();
        }
        if (
            homeDelivered > MAX_DELIVERED || awayDelivered > MAX_DELIVERED || homeTurns > MAX_TURNS
                || awayTurns > MAX_TURNS || homeTurns < homeDelivered || awayTurns < awayDelivered
        ) revert BadTuple();

        Tuple memory t = Tuple(replayHash, homeDelivered, homeTurns, awayDelivered, awayTurns);
        if (msg.sender == homeCaptain) {
            f.homeReported = true;
            f.homeReport = t;
        } else {
            f.awayReported = true;
            f.awayReport = t;
        }
        emit Attested(id, msg.sender, replayHash, homeDelivered, homeTurns, awayDelivered, awayTurns);

        if (f.homeReported && f.awayReported) {
            if (_tuplesEqual(f.homeReport, f.awayReport)) {
                f.state = State.Accepted;
                f.outcome = _outcome(t);
                emit Accepted(id, f.outcome, replayHash, homeDelivered, homeTurns, awayDelivered, awayTurns);
            } else {
                f.state = State.Disputed;
                emit Disputed(id, f.homeReport, f.awayReport);
            }
        }
    }

    /// @notice Permissionless close of a fixture still open after attestation
    /// close. Finalizes once; no points accrue.
    function expire(uint64 id) external {
        Fixture storage f = _fixture(id);
        if (f.state != State.Open) revert Terminal();
        if (block.timestamp < f.attestClose) revert NotExpired();
        f.state = State.Expired;
        emit Expired(id);
    }

    /// ---- reads used by the indexer and desk ----

    function fixture(uint64 id) external view returns (Fixture memory) {
        return _fixture(id);
    }

    function scheduleKeyUsed(bytes32 key) external view returns (bool) {
        return fixtureIdByScheduleKey[key] != 0;
    }

    function _fixture(uint64 id) private view returns (Fixture storage f) {
        f = fixtures[id];
        if (f.scheduleKey == bytes32(0)) revert NoSuchFixture();
    }

    function _isPermutation(uint8[5] calldata order) private pure returns (bool) {
        uint8 seen;
        for (uint256 i = 0; i < 5; i++) {
            uint8 v = order[i];
            if (v >= 5) return false;
            uint8 bit = uint8(1 << v);
            if (seen & bit != 0) return false;
            seen |= bit;
        }
        return seen == 31;
    }

    function _tuplesEqual(Tuple memory a, Tuple memory b) private pure returns (bool) {
        return a.replayHash == b.replayHash && a.homeDelivered == b.homeDelivered
            && a.homeTurns == b.homeTurns && a.awayDelivered == b.awayDelivered
            && a.awayTurns == b.awayTurns;
    }

    /// Higher deliveries win; on equal deliveries fewer turns win; else draw.
    function _outcome(Tuple memory t) private pure returns (Outcome) {
        if (t.homeDelivered != t.awayDelivered) {
            return t.homeDelivered > t.awayDelivered ? Outcome.HomeWin : Outcome.AwayWin;
        }
        if (t.homeTurns != t.awayTurns) {
            return t.homeTurns < t.awayTurns ? Outcome.HomeWin : Outcome.AwayWin;
        }
        return Outcome.Draw;
    }
}
