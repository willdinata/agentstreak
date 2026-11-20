// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockAgentID
/// @notice Minimal ERC-721-like mock of the Agent ID contract, for tests only.
///         Exposes `balanceOf` (the only function AgentStreak uses) plus a
///         public `mint(to)` so tests can create holder / non-holder cases.
/// @dev NOT for production or deployment. The real Agent ID is non-transferable
///      and is claimed only inside the Binance App; this mock deliberately
///      does not model transfers.
contract MockAgentID {
    string public constant name = "Mock Agent ID";
    string public constant symbol = "AI";

    mapping(address => uint256) private _balances;
    uint256 public totalMinted;

    event Minted(address indexed to, uint256 balance);

    error ZeroAddress();

    /// @notice Test-only mint: gives `to` one (more) mock Agent ID(s).
    function mint(address to) external {
        if (to == address(0)) revert ZeroAddress();
        _balances[to] += 1;
        totalMinted += 1;
        emit Minted(to, _balances[to]);
    }

    /// @notice ERC-721-style balance: > 0 means the address is a holder.
    function balanceOf(address owner) external view returns (uint256) {
        return _balances[owner];
    }
}
