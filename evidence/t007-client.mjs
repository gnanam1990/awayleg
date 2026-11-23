// T-007 — official client interaction on the authorized local deployment (anvil).
// A fresh consenting-holder wallet: funded, previewed via referee CLI intent,
// rejected out of window, retried in window, confirmed receipt on chain.
// Key material is never printed — evidence records only public addresses.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseEther,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const RPC = 'http://127.0.0.1:8545';
const REG = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const organizer = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

// Fresh wallets — the "consenting holders" for this rehearsal.
const holderKey = generatePrivateKey();
const holder = privateKeyToAccount(holderKey);        // away captain
const holder2Key = generatePrivateKey();
const holder2 = privateKeyToAccount(holder2Key);      // home captain

const pub = createPublicClient({ transport: http(RPC) });
const wallet = (a) => createWalletClient({ account: a, transport: http(RPC) });

const SEASON_ABI = [
  { type: 'function', name: 'createFixture', stateMutability: 'nonpayable',
    inputs: [{ name: 'scheduleKey', type: 'bytes32' }, { name: 'home', type: 'address' }, { name: 'away', type: 'address' }, { name: 'courseHash', type: 'bytes32' }, { name: 'entryClose', type: 'uint64' }, { name: 'attestClose', type: 'uint64' }],
    outputs: [{ name: 'id', type: 'uint64' }] },
  { type: 'function', name: 'lockStrategy', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint64' }, { name: 'order', type: 'uint8[5]' }], outputs: [] },
  { type: 'function', name: 'attest', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint64' }, { name: 'replayHash', type: 'bytes32' }, { name: 'homeDelivered', type: 'uint8' }, { name: 'homeTurns', type: 'uint8' }, { name: 'awayDelivered', type: 'uint8' }, { name: 'awayTurns', type: 'uint8' }], outputs: [] },
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
  return { hash, blockNumber: rc.blockNumber.toString() };
};

const warp = async (s) => {
  await pub.transport.request({ method: 'evm_increaseTime', params: [s] });
  await pub.transport.request({ method: 'evm_mine', params: [] });
};

const corridor = JSON.parse(readFileSync(new URL('../fixtures/corridor.json', import.meta.url)));
const courseHash = corridor.courseSha256;
const REPLAY = corridor.replaySha256;
const evidence = { deployment: 'local anvil (chain 31337)', steps: [] };
const note = (k, v) => { evidence.steps.push({ [k]: v }); console.log(k, JSON.stringify(v).slice(0, 200)); };

// 0. Fresh season deployment where the consenting holders ARE the captains
//    (captains are immutable per deployment on AwayLegSeason).
const seasonArt = JSON.parse(readFileSync(new URL('../contracts/out/AwayLegSeason.sol/AwayLegSeason.json', import.meta.url)));
const deployHash = await wallet(organizer).deployContract({
  abi: seasonArt.abi,
  bytecode: seasonArt.bytecode.object,
  args: [organizer.address, REG, holder2.address, holder.address],
});
const deployRc = await pub.waitForTransactionReceipt({ hash: deployHash });
const SEASON = deployRc.contractAddress;
note('season_deployed', { address: SEASON, tx: deployHash, homeCaptain: holder2.address, awayCaptain: holder.address });

// 1. Fund the consenting holder wallets (gas only).
for (const w of [holder.address, holder2.address]) {
  const h = await wallet(organizer).sendTransaction({ to: w, value: parseEther('0.5') });
  await pub.waitForTransactionReceipt({ hash: h });
}
note('holders_funded', { home: holder2.address, away: holder.address });

// 2. Registry balances + fixture where the holders are entrants, and where the
//    fresh wallets operate as their own club captains.
const homeEntrant = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
const awayEntrant = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65';
const now = (await pub.getBlock()).timestamp;
const ENTRY_CLOSE = now + 300n;
const ATTEST_CLOSE = now + 7200n;
const scheduleKey = '0x' + Buffer.from(`t007-fx-${Date.now().toString(16)}`.padEnd(32, '0')).toString('hex');
await send(organizer, SEASON, SEASON_ABI, 'createFixture',
  [scheduleKey, homeEntrant, awayEntrant, courseHash, ENTRY_CLOSE, ATTEST_CLOSE]);
const FX = await pub.readContract({ address: SEASON, abi: SEASON_ABI, functionName: 'fixtureCount', args: [] });
note('fixture_created', { id: FX.toString(), scheduleKey });

// entrants already carry registry balance 1 from the pilot rehearsal
await send(privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'), SEASON, SEASON_ABI, 'lockStrategy', [FX, [0, 1, 2, 3, 4]]);
await send(privateKeyToAccount('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a'), SEASON, SEASON_ABI, 'lockStrategy', [FX, [4, 3, 2, 1, 0]]);
note('orders_locked', { fixture: FX.toString() });

// 3. Local preview: referee run rebuilds the bundle from chain logs, then the
//    CLI prints the decoded wallet intent — previewed locally, never broadcast.
// anvil finalized lag ~64 blocks — mine past it so the fixture is finalized.
await pub.transport.request({ method: 'anvil_mine', params: ['0x60'] });

const bin = new URL('../packages/referee/bin/awayleg.js', import.meta.url).pathname;
const bundleDir = `/tmp/t007-bundle-${Date.now()}`;
const coursePath = `/tmp/t007-course-${Date.now()}.bin`;
writeFileSync(coursePath, JSON.stringify(corridor.course));
execFileSync('node', [bin, 'referee', 'run', '--chain', '31337', '--contract', SEASON,
  '--fixture', FX.toString(), '--course', coursePath, '--out', bundleDir,
  '--rpc', RPC, '--registry', REG], { encoding: 'utf8' });
const preview = execFileSync('node', [bin, 'attest', '--contract', SEASON, '--fixture', FX.toString(),
  '--bundle', bundleDir], { encoding: 'utf8' });
const intentJson = JSON.parse(preview.slice(preview.indexOf('{')));
note('local_preview_redacted', intentJson);

// 4. Rejection: attest before the window opens (direct caller = fresh holder).
let rejected;
try {
  await wallet(holder).writeContract({ address: SEASON, abi: SEASON_ABI, functionName: 'attest',
    args: [FX, REPLAY, 5, 5, 5, 9] });
  rejected = 'NO REVERT — unexpected';
} catch (e) {
  rejected = /0xb88b9dc5|AttestWindow/.test(e.message) ? 'reverted AttestWindow (0xb88b9dc5)' : `reverted: ${e.message.slice(0, 80)}`;
}
note('rejected_before_window', rejected);

// 5. Retry inside the window → confirmed receipt.
await warp(400);
const r1 = await send(holder, SEASON, SEASON_ABI, 'attest', [FX, REPLAY, 5, 5, 5, 9]);
note('attest_confirmed_receipt', { caller: holder.address, tx: r1.hash, block: r1.blockNumber });

const r2 = await send(holder2, SEASON, SEASON_ABI, 'attest', [FX, REPLAY, 5, 5, 5, 9]);
const f = await pub.readContract({ address: SEASON, abi: SEASON_ABI, functionName: 'fixture', args: [FX] });
note('second_attest_accepted', { caller: holder2.address, tx: r2.hash, state: f.state, outcome: f.outcome });

writeFileSync(new URL('./T-007-client.json', import.meta.url), JSON.stringify(evidence, null, 2));
console.log('wrote evidence/T-007-client.json');
