// M06 pilot rehearsal — T-017/T-018 on local anvil.
// Drives: registry balances → createFixture → 2 locks → 2 attest → Accepted;
// a second fixture with mismatched tuples → Disputed; indexer sync + standings.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPC = 'http://127.0.0.1:8545';
const SEASON = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const REG = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

const organizer = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const homeCaptain = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const awayCaptain = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const homeEntrant = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'); // 0x90f7...
const awayEntrant = privateKeyToAccount('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a'); // 0x15d3...

const pub = createPublicClient({ transport: http(RPC) });
const wallet = (acct) => createWalletClient({ account: acct, transport: http(RPC) });

const SEASON_ABI = [
  { type: 'function', name: 'createFixture', stateMutability: 'nonpayable',
    inputs: [{ name: 'scheduleKey', type: 'bytes32' }, { name: 'home', type: 'address' }, { name: 'away', type: 'address' }, { name: 'courseHash', type: 'bytes32' }, { name: 'entryClose', type: 'uint64' }, { name: 'attestClose', type: 'uint64' }],
    outputs: [{ name: 'id', type: 'uint64' }] },
  { type: 'function', name: 'lockStrategy', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint64' }, { name: 'order', type: 'uint8[5]' }], outputs: [] },
  { type: 'function', name: 'attest', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint64' }, { name: 'replayHash', type: 'bytes32' }, { name: 'homeDelivered', type: 'uint8' }, { name: 'homeTurns', type: 'uint8' }, { name: 'awayDelivered', type: 'uint8' }, { name: 'awayTurns', type: 'uint8' }], outputs: [] },
  { type: 'function', name: 'expire', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'fixtureCount', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint64' }] },
  { type: 'function', name: 'fixture', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint64' }],
    outputs: [{ name: '', type: 'tuple', components: [
      { name: 'entryClose', type: 'uint64' }, { name: 'attestClose', type: 'uint64' },
      { name: 'scheduleKey', type: 'bytes32' }, { name: 'courseHash', type: 'bytes32' },
      { name: 'homeEntrant', type: 'address' }, { name: 'awayEntrant', type: 'address' },
      { name: 'state', type: 'uint8' }, { name: 'outcome', type: 'uint8' },
      { name: 'homeOrder', type: 'uint8[5]' }, { name: 'awayOrder', type: 'uint8[5]' },
      { name: 'homeLocked', type: 'bool' }, { name: 'awayLocked', type: 'bool' },
      { name: 'homeReport', type: 'tuple', components: [
        { name: 'replayHash', type: 'bytes32' }, { name: 'homeDelivered', type: 'uint8' },
        { name: 'homeTurns', type: 'uint8' }, { name: 'awayDelivered', type: 'uint8' }, { name: 'awayTurns', type: 'uint8' }] },
      { name: 'awayReport', type: 'tuple', components: [
        { name: 'replayHash', type: 'bytes32' }, { name: 'homeDelivered', type: 'uint8' },
        { name: 'homeTurns', type: 'uint8' }, { name: 'awayDelivered', type: 'uint8' }, { name: 'awayTurns', type: 'uint8' }] },
      { name: 'homeReported', type: 'bool' }, { name: 'awayReported', type: 'bool' },
    ] }] },
  { type: 'event', name: 'Accepted', inputs: [
    { name: 'id', type: 'uint64', indexed: true }, { name: 'replayHash', type: 'bytes32', indexed: false }, { name: 'outcome', type: 'uint8', indexed: false }] },
];

const REG_ABI = [
  { type: 'function', name: 'setBalance', stateMutability: 'nonpayable',
    inputs: [{ name: 'who', type: 'address' }, { name: 'n', type: 'uint256' }], outputs: [] },
];

const send = async (acct, to, abi, fn, args) => {
  const hash = await wallet(acct).sendTransaction({
    to, data: encodeFunctionData({ abi, functionName: fn, args }),
  });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`${fn} reverted`);
  return { hash, blockNumber: rc.blockNumber };
};

const corridor = JSON.parse(readFileSync(new URL('../fixtures/corridor.json', import.meta.url)));
const courseBytes = Buffer.from(JSON.stringify(corridor.course), 'utf8');
const courseHash = '0x' + createHash('sha256').update(courseBytes).digest('hex');
const REPLAY = '0x5bc5556fe729bd9809d6e2b772870009b11441e5c7a50bc5295d4640ce53e5ac';

const now = (await pub.getBlock()).timestamp;
const ENTRY_CLOSE = now + 60n;
const ATTEST_CLOSE = now + 7200n;
const ENTRY_CLOSE_2 = now + 600n;

const warp = async (seconds) => {
  await pub.transport.request({ method: 'evm_increaseTime', params: [seconds] });
  await pub.transport.request({ method: 'evm_mine', params: [] });
};

console.log('courseHash', courseHash, 'expected', corridor.courseSha256);
if (courseHash !== corridor.courseSha256) throw new Error('course hash mismatch');

// balances
for (const e of [homeEntrant.address, awayEntrant.address]) {
  await send(organizer, REG, REG_ABI, 'setBalance', [e, 1n]);
}

// fixture 1 — matching attestation → Accepted
const scheduleKey = '0x' + Buffer.from(`season-1-fx-${Date.now().toString(16)}-0`.padEnd(32,'0')).toString('hex');
await send(organizer, SEASON, SEASON_ABI, 'createFixture',
  [scheduleKey, homeEntrant.address, awayEntrant.address, courseHash, ENTRY_CLOSE, ATTEST_CLOSE]);
const FX1 = await pub.readContract({ address: SEASON, abi: SEASON_ABI, functionName: 'fixtureCount', args: [] });
console.log('fixture id A', FX1);

await send(homeEntrant, SEASON, SEASON_ABI, 'lockStrategy', [FX1, [0, 1, 2, 3, 4]]);
await send(awayEntrant, SEASON, SEASON_ABI, 'lockStrategy', [FX1, [4, 3, 2, 1, 0]]);
await warp(90);
await send(homeCaptain, SEASON, SEASON_ABI, 'attest', [FX1, REPLAY, 5, 5, 5, 9]);
await send(awayCaptain, SEASON, SEASON_ABI, 'attest', [FX1, REPLAY, 5, 5, 5, 9]);
const f1b = await pub.readContract({ address: SEASON, abi: SEASON_ABI, functionName: 'fixture', args: [FX1] });
console.log('fixture 1 after attest: state', f1b.state, 'outcome', f1b.outcome);

// fixture 2 — mismatched tuples → Disputed
await send(organizer, SEASON, SEASON_ABI, 'createFixture',
  ['0x' + Buffer.from(`season-1-fx-${Date.now().toString(16)}-1`.padEnd(32,'0')).toString('hex'),
   homeEntrant.address, awayEntrant.address, courseHash, ENTRY_CLOSE_2, ATTEST_CLOSE]);
const FX2 = await pub.readContract({ address: SEASON, abi: SEASON_ABI, functionName: 'fixtureCount', args: [] });
console.log('fixture id B', FX2);
await send(homeEntrant, SEASON, SEASON_ABI, 'lockStrategy', [FX2, [0, 1, 2, 3, 4]]);
await send(awayEntrant, SEASON, SEASON_ABI, 'lockStrategy', [FX2, [4, 3, 2, 1, 0]]);
await warp(600);
await send(homeCaptain, SEASON, SEASON_ABI, 'attest', [FX2, REPLAY, 5, 5, 5, 9]);
await send(awayCaptain, SEASON, SEASON_ABI, 'attest', [FX2, REPLAY, 4, 6, 5, 9]); // wrong home numbers
const f2 = await pub.readContract({ address: SEASON, abi: SEASON_ABI, functionName: 'fixture', args: [FX2] });
console.log('fixture 2 after attest: state', f2.state);

const head = await pub.getBlockNumber();
console.log('head', head);
console.log(JSON.stringify({
  SEASON, REG,
  entrants: { home: homeEntrant.address, away: awayEntrant.address },
  captains: { home: homeCaptain.address, away: awayCaptain.address },
}, null, 2));
