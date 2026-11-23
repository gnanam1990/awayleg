// Finalized fixture reads and wallet intents for AwayLegSeason.
import { createPublicClient, encodeFunctionData, http } from 'viem';
import { SEASON_ABI } from './abi.js';

// Every write is a user-reviewed nonpayable action through the actor's own
// wallet; these intents are the decoded calldata the official local wallet
// client previews before consent.
export function intents(contract) {
  const c = contract.toLowerCase();
  return {
    createFixture: (scheduleKey, home, away, courseHash, entryClose, attestClose) => ({
      to: c,
      value: '0',
      data: encodeFunctionData({
        abi: SEASON_ABI,
        functionName: 'createFixture',
        args: [scheduleKey, home, away, courseHash, entryClose, attestClose],
      }),
      description: `schedule fixture home=${home} away=${away} course=${courseHash.slice(0, 10)}…`,
    }),
    lockStrategy: (fixtureId, order) => ({
      to: c,
      value: '0',
      data: encodeFunctionData({
        abi: SEASON_ABI,
        functionName: 'lockStrategy',
        args: [BigInt(fixtureId), order],
      }),
      description: `lock strategy ${JSON.stringify(order)} for fixture ${fixtureId}`,
    }),
    attest: (fixtureId, tuple) => ({
      to: c,
      value: '0',
      data: encodeFunctionData({
        abi: SEASON_ABI,
        functionName: 'attest',
        args: [
          BigInt(fixtureId),
          tuple.replayHash,
          tuple.homeDelivered,
          tuple.homeTurns,
          tuple.awayDelivered,
          tuple.awayTurns,
        ],
      }),
      description: `attest fixture ${fixtureId} replay=${tuple.replayHash.slice(0, 10)}… scores ${tuple.homeDelivered}/${tuple.homeTurns} vs ${tuple.awayDelivered}/${tuple.awayTurns}`,
    }),
    expire: (fixtureId) => ({
      to: c,
      value: '0',
      data: encodeFunctionData({
        abi: SEASON_ABI,
        functionName: 'expire',
        args: [BigInt(fixtureId)],
      }),
      description: `expire fixture ${fixtureId}`,
    }),
  };
}

export class ChainReader {
  constructor(rpcUrl, expectedChainId = null) {
    this.client = createPublicClient({ transport: http(rpcUrl) });
    this.expectedChainId = expectedChainId;
  }

  async getChainId() {
    const id = await this.client.getChainId();
    if (this.expectedChainId && id !== this.expectedChainId) {
      throw new Error(`chain id ${id} != expected ${this.expectedChainId}`);
    }
    return id;
  }

  async getFinalizedHead() {
    try {
      const b = await this.client.getBlock({ blockTag: 'finalized' });
      return { number: Number(b.number), hash: b.hash };
    } catch {
      return null;
    }
  }

  async getBlock(number) {
    const b = await this.client.getBlock({ blockNumber: BigInt(number) });
    return { number: Number(b.number), hash: b.hash, parentHash: b.parentHash };
  }

  async getFixture(contract, fixtureId) {
    return this.client.readContract({
      address: contract,
      abi: SEASON_ABI,
      functionName: 'fixture',
      args: [BigInt(fixtureId)],
    });
  }

  async getLogs(address, fromBlock, toBlock) {
    const logs = await this.client.getLogs({
      address,
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
    });
    return logs.map((l) => ({
      blockNumber: Number(l.blockNumber),
      blockHash: l.blockHash,
      transactionHash: l.transactionHash,
      transactionIndex: l.transactionIndex ?? 0,
      logIndex: Number(l.logIndex),
      data: l.data,
      topics: l.topics,
    }));
  }
}
