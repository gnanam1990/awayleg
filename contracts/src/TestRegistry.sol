// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Replaceable test registry for local-chain tests only.
/// Production deployments bind the immutable real Agent ID registry.
contract TestRegistry {
    mapping(address => uint256) private balances;
    bool public failReads;

    function setBalance(address who, uint256 amount) external {
        balances[who] = amount;
    }

    function setFailReads(bool fail) external {
        failReads = fail;
    }

    function balanceOf(address who) external view returns (uint256) {
        require(!failReads, "registry read failed");
        return balances[who];
    }
}
