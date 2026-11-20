// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interface for the Agent ID contract (SPACE ID Agent ID, ERC-721).
/// @dev The real contract on BNB Chain is 0x60b9262456de011f7d15a54cdd8c48baaa8b022f.
///      Only `balanceOf` is needed: a return value > 0 means the address holds an Agent ID.
interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
}

/// @title AgentStreak
/// @notice Sybil-proof daily loyalty protocol for AI agents.
///         Only Agent ID holders can check in on-chain once per UTC day,
///         build a streak, earn points, and level up.
///         1 person = 1 Agent ID (non-transferable) = 1 streak identity.
/// @dev This contract holds no funds. It has NO transfer, swap, approval,
///      deposit, or withdrawal functions. The owner can only pause/unpause
///      check-ins in an emergency; the owner cannot move funds (there are
///      none), cannot mint, cannot change the Agent ID contract (immutable),
///      and cannot edit user streaks/points.
contract AgentStreak {
    // ---------------------------------------------------------------------
    // Level encoding (derived from a user's total check-ins)
    //   0 = None       (0 check-ins)
    //   1 = Starter    (1+ check-ins)
    //   2 = Regular    (7+ check-ins)
    //   3 = Committed  (14+ check-ins)
    //   4 = Core Agent (30+ check-ins)
    // ---------------------------------------------------------------------
    uint8 public constant LEVEL_NONE = 0;
    uint8 public constant LEVEL_STARTER = 1;
    uint8 public constant LEVEL_REGULAR = 2;
    uint8 public constant LEVEL_COMMITTED = 3;
    uint8 public constant LEVEL_CORE_AGENT = 4;

    /// @notice The Agent ID contract used for the holder gate. Immutable.
    IAgentID public immutable agentId;

    /// @notice Deployer / emergency operator. Can only pause/unpause.
    address public immutable owner;

    /// @notice Whether check-ins are paused (emergency only).
    bool public paused;

    struct User {
        uint256 lastDay;      // last UTC day (block.timestamp / 86400) of a check-in
        uint256 streak;       // current consecutive-day streak
        uint256 totalCheckIns; // lifetime check-ins for this user
        uint256 points;       // lifetime points for this user
    }

    mapping(address => User) private _users;

    /// @notice Number of unique addresses that have ever checked in.
    uint256 public totalUsers;

    /// @notice Total check-ins across all users.
    uint256 public totalCheckIns;

    event CheckedIn(
        address indexed user,
        uint256 day,
        uint256 streak,
        uint256 pointsAwarded,
        uint256 totalPoints
    );

    event Paused(address indexed by);
    event Unpaused(address indexed by);

    error NotOwner();
    error IsPaused();
    error NotAgentIdHolder();
    error AlreadyCheckedInToday();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    /// @param agentId_ Address of the Agent ID (ERC-721) contract.
    constructor(address agentId_) {
        if (agentId_ == address(0)) revert ZeroAddress();
        agentId = IAgentID(agentId_);
        owner = msg.sender;
    }

    // ---------------------------------------------------------------------
    // Core action
    // ---------------------------------------------------------------------

    /// @notice Check in for today. Agent ID holders only, once per UTC day.
    /// @dev Consecutive day: streak +1. Missed day (or first check-in):
    ///      streak resets to 1. Same day: reverts.
    ///      Points awarded = 10 + min(newStreak, 20).
    function checkIn() external whenNotPaused {
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();

        uint256 day = block.timestamp / 86400;

        User storage user = _users[msg.sender];
        if (user.totalCheckIns > 0 && user.lastDay == day) {
            revert AlreadyCheckedInToday();
        }

        uint256 newStreak;
        if (user.totalCheckIns > 0 && user.lastDay == day - 1) {
            newStreak = user.streak + 1;
        } else {
            newStreak = 1;
        }

        uint256 bonus = newStreak < 20 ? newStreak : 20;
        uint256 pointsAwarded = 10 + bonus;

        if (user.totalCheckIns == 0) {
            totalUsers += 1;
        }

        user.lastDay = day;
        user.streak = newStreak;
        user.totalCheckIns += 1;
        user.points += pointsAwarded;
        totalCheckIns += 1;

        emit CheckedIn(msg.sender, day, newStreak, pointsAwarded, user.points);
    }

    // ---------------------------------------------------------------------
    // Owner (emergency only)
    // ---------------------------------------------------------------------

    /// @notice Pause check-ins. Owner only. Does not affect any funds
    ///         (the contract holds none) or existing user state.
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Resume check-ins. Owner only.
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Whether `account` could successfully check in right now:
    ///         contract not paused, account holds an Agent ID, and the
    ///         account has not already checked in today (UTC).
    function canCheckInToday(address account) external view returns (bool) {
        if (paused) return false;
        if (account == address(0)) return false;
        if (agentId.balanceOf(account) == 0) return false;
        User storage user = _users[account];
        if (user.totalCheckIns > 0 && user.lastDay == block.timestamp / 86400) {
            return false;
        }
        return true;
    }

    /// @notice Full streak state for `account`.
    /// @return streak Current consecutive-day streak.
    /// @return totalCheckIns_ Lifetime check-ins for this user.
    /// @return points Lifetime points for this user.
    /// @return level Level as uint8: 0=None, 1=Starter, 2=Regular,
    ///               3=Committed, 4=Core Agent (see levelName()).
    /// @return lastDay Last UTC day number of a check-in (0 if never).
    function getUser(address account)
        external
        view
        returns (
            uint256 streak,
            uint256 totalCheckIns_,
            uint256 points,
            uint8 level,
            uint256 lastDay
        )
    {
        User storage user = _users[account];
        return (
            user.streak,
            user.totalCheckIns,
            user.points,
            levelOf(user.totalCheckIns),
            user.lastDay
        );
    }

    /// @notice Derive the level for a given lifetime check-in count.
    function levelOf(uint256 totalCheckIns_) public pure returns (uint8) {
        if (totalCheckIns_ >= 30) return LEVEL_CORE_AGENT;
        if (totalCheckIns_ >= 14) return LEVEL_COMMITTED;
        if (totalCheckIns_ >= 7) return LEVEL_REGULAR;
        if (totalCheckIns_ >= 1) return LEVEL_STARTER;
        return LEVEL_NONE;
    }

    /// @notice Human-readable name for a level value returned by getUser().
    function levelName(uint8 level) public pure returns (string memory) {
        if (level == LEVEL_CORE_AGENT) return "Core Agent";
        if (level == LEVEL_COMMITTED) return "Committed";
        if (level == LEVEL_REGULAR) return "Regular";
        if (level == LEVEL_STARTER) return "Starter";
        return "None";
    }
}
