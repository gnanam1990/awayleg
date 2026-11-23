// Log sources. The worker talks to a LogSource only through this interface:
//   getChainId()            -> number
//   getFinalizedHead()      -> { number, hash } | null (finalized tag)
//   getBlock(number)        -> { number, hash, parentHash } | null
//   getLogs(addr, from, to) -> raw logs [{blockNumber, blockHash,
//                              transactionHash, logIndex, data, topics}]
// ViemSource binds a real RPC; FakeChain drives tests with a mutable chain.

import { createPublicClient, http } from 'viem';
import { decodeLog } from '@awayleg/chain';

export class ViemSource {
  constructor(rpcUrl, expectedChainId) {
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
      const block = await this.client.getBlock({ blockTag: 'finalized' });
      return { number: Number(block.number), hash: block.hash };
    } catch {
      return null; // finality unavailable: stop advancement
    }
  }

  async getBlock(number) {
    try {
      const b = await this.client.getBlock({ blockNumber: BigInt(number) });
      return { number: Number(b.number), hash: b.hash, parentHash: b.parentHash };
    } catch {
      return null;
    }
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

// In-memory chain for tests: deliver logs late, twice, or after a reorg.
export class FakeChain {
  constructor(chainId = 31337) {
    this.chainId = chainId;
    this.blocks = []; // [{number, hash, parentHash}]
    this.logs = [];   // raw log rows
    this.finalizedLag = 0;
    this.fork = 0;    // reorg salt so re-mined heights hash differently
  }

  mineBlock(logs = []) {
    const number = this.blocks.length;
    const parentHash = number === 0 ? 'genesis' : this.blocks[number - 1].hash;
    const hash = `0x${(number.toString(16) + 'f'.repeat(59) + this.fork.toString(16)).padStart(64, '0')}`.slice(0, 66);
    this.blocks.push({ number, hash, parentHash });
    for (const l of logs) {
      this.logs.push({
        blockNumber: number,
        blockHash: hash,
        transactionHash: l.txHash ?? `0xtx${this.logs.length.toString(16)}`,
        transactionIndex: l.txIndex ?? 0,
        logIndex: l.logIndex ?? this.logs.filter((x) => x.blockNumber === number).length,
        data: l.data,
        topics: l.topics,
      });
    }
    return { number, hash };
  }

  // Replace blocks >= fromNumber (reorg), optionally carrying new logs.
  reorg(fromNumber, blocksWithLogs = []) {
    this.fork += 1;
    this.blocks = this.blocks.slice(0, fromNumber);
    this.logs = this.logs.filter((l) => l.blockNumber < fromNumber);
    for (const logs of blocksWithLogs) this.mineBlock(logs);
  }

  async getChainId() {
    return this.chainId;
  }

  async getFinalizedHead() {
    if (this.blocks.length === 0) return null;
    const idx = Math.max(0, this.blocks.length - 1 - this.finalizedLag);
    const b = this.blocks[idx];
    return { number: b.number, hash: b.hash };
  }

  async getBlock(number) {
    const b = this.blocks[number];
    return b ? { number: b.number, hash: b.hash, parentHash: b.parentHash } : null;
  }

  async getLogs(_address, fromBlock, toBlock) {
    return this.logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
  }
}

// Encode a contract event into raw log form for FakeChain (topics + data).
// Uses viem's encoder so fake logs exercise the real decoder.
import { encodeEventTopics, encodeAbiParameters, parseAbiItem } from 'viem';
import { SEASON_ABI } from '@awayleg/chain';

export function fakeLog(address, eventName, args) {
  const eventDef = SEASON_ABI.find((i) => i.type === 'event' && i.name === eventName);
  const inputs = eventDef.inputs;
  const topics = encodeEventTopics({ abi: [eventDef], eventName, args });
  const nonIndexed = inputs.filter((i) => !i.indexed);
  const data =
    nonIndexed.length === 0
      ? '0x'
      : encodeAbiParameters(
          nonIndexed.map((i) => ({
            type: i.type,
            name: i.name,
            components: i.components,
          })),
          nonIndexed.map((i) => args[i.name]),
        );
  return { address, data, topics };
}

export function decodeRaw(rawLog) {
  return decodeLog(rawLog);
}
