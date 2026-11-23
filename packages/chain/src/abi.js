// Contract ABI for AwayLegSeason events + the reads the desk needs.
import { decodeEventLog } from 'viem';

export const SEASON_ABI = [
  {
    type: 'event',
    name: 'FixtureCreated',
    inputs: [
      { name: 'id', type: 'uint64', indexed: true },
      { name: 'scheduleKey', type: 'bytes32', indexed: true },
      { name: 'homeEntrant', type: 'address', indexed: true },
      { name: 'awayEntrant', type: 'address' },
      { name: 'homeCaptain', type: 'address' },
      { name: 'awayCaptain', type: 'address' },
      { name: 'courseHash', type: 'bytes32' },
      { name: 'entryClose', type: 'uint64' },
      { name: 'attestClose', type: 'uint64' },
    ],
  },
  {
    type: 'event',
    name: 'StrategyLocked',
    inputs: [
      { name: 'id', type: 'uint64', indexed: true },
      { name: 'slot', type: 'uint8', indexed: true },
      { name: 'entrant', type: 'address', indexed: true },
      { name: 'order', type: 'uint8[5]' },
    ],
  },
  {
    type: 'event',
    name: 'Attested',
    inputs: [
      { name: 'id', type: 'uint64', indexed: true },
      { name: 'captain', type: 'address', indexed: true },
      { name: 'replayHash', type: 'bytes32' },
      { name: 'homeDelivered', type: 'uint8' },
      { name: 'homeTurns', type: 'uint8' },
      { name: 'awayDelivered', type: 'uint8' },
      { name: 'awayTurns', type: 'uint8' },
    ],
  },
  {
    type: 'event',
    name: 'Accepted',
    inputs: [
      { name: 'id', type: 'uint64', indexed: true },
      { name: 'outcome', type: 'uint8' },
      { name: 'replayHash', type: 'bytes32' },
      { name: 'homeDelivered', type: 'uint8' },
      { name: 'homeTurns', type: 'uint8' },
      { name: 'awayDelivered', type: 'uint8' },
      { name: 'awayTurns', type: 'uint8' },
    ],
  },
  {
    type: 'event',
    name: 'Disputed',
    inputs: [
      { name: 'id', type: 'uint64', indexed: true },
      {
        name: 'homeReport',
        type: 'tuple',
        components: [
          { name: 'replayHash', type: 'bytes32' },
          { name: 'homeDelivered', type: 'uint8' },
          { name: 'homeTurns', type: 'uint8' },
          { name: 'awayDelivered', type: 'uint8' },
          { name: 'awayTurns', type: 'uint8' },
        ],
      },
      {
        name: 'awayReport',
        type: 'tuple',
        components: [
          { name: 'replayHash', type: 'bytes32' },
          { name: 'homeDelivered', type: 'uint8' },
          { name: 'homeTurns', type: 'uint8' },
          { name: 'awayDelivered', type: 'uint8' },
          { name: 'awayTurns', type: 'uint8' },
        ],
      },
    ],
  },
  {
    type: 'event',
    name: 'Expired',
    inputs: [{ name: 'id', type: 'uint64', indexed: true }],
  },
  {
    type: 'function',
    name: 'fixture',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint64' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'entryClose', type: 'uint64' },
          { name: 'attestClose', type: 'uint64' },
          { name: 'scheduleKey', type: 'bytes32' },
          { name: 'courseHash', type: 'bytes32' },
          { name: 'homeEntrant', type: 'address' },
          { name: 'awayEntrant', type: 'address' },
          { name: 'state', type: 'uint8' },
          { name: 'outcome', type: 'uint8' },
          { name: 'homeOrder', type: 'uint8[5]' },
          { name: 'awayOrder', type: 'uint8[5]' },
          { name: 'homeLocked', type: 'bool' },
          { name: 'awayLocked', type: 'bool' },
          {
            name: 'homeReport',
            type: 'tuple',
            components: [
              { name: 'replayHash', type: 'bytes32' },
              { name: 'homeDelivered', type: 'uint8' },
              { name: 'homeTurns', type: 'uint8' },
              { name: 'awayDelivered', type: 'uint8' },
              { name: 'awayTurns', type: 'uint8' },
            ],
          },
          {
            name: 'awayReport',
            type: 'tuple',
            components: [
              { name: 'replayHash', type: 'bytes32' },
              { name: 'homeDelivered', type: 'uint8' },
              { name: 'homeTurns', type: 'uint8' },
              { name: 'awayDelivered', type: 'uint8' },
              { name: 'awayTurns', type: 'uint8' },
            ],
          },
          { name: 'homeReported', type: 'bool' },
          { name: 'awayReported', type: 'bool' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'fixtureIdByScheduleKey',
    stateMutability: 'view',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint64' }],
  },
  {
    type: 'function',
    name: 'fixtureCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint64' }],
  },
  {
    type: 'function',
    name: 'homeCaptain',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'awayCaptain',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
];

const EVENT_NAMES = new Set(
  SEASON_ABI.filter((i) => i.type === 'event').map((i) => i.name),
);

// Decodes a raw log into a normalized record. Returns null for unrelated logs.
export function decodeLog(log) {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: SEASON_ABI, data: log.data, topics: log.topics });
  } catch {
    return null;
  }
  if (!EVENT_NAMES.has(decoded.eventName)) return null;
  const args = decoded.args;
  const out = {
    kind: decoded.eventName,
    fixtureId: args.id !== undefined ? Number(args.id) : null,
    raw: args,
  };
  switch (decoded.eventName) {
    case 'FixtureCreated':
      Object.assign(out, {
        scheduleKey: args.scheduleKey,
        homeEntrant: args.homeEntrant.toLowerCase(),
        awayEntrant: args.awayEntrant.toLowerCase(),
        homeCaptain: args.homeCaptain.toLowerCase(),
        awayCaptain: args.awayCaptain.toLowerCase(),
        courseHash: args.courseHash,
        entryClose: Number(args.entryClose),
        attestClose: Number(args.attestClose),
      });
      break;
    case 'StrategyLocked':
      Object.assign(out, {
        slot: Number(args.slot),
        entrant: args.entrant.toLowerCase(),
        order: Array.from(args.order, Number),
      });
      break;
    case 'Attested':
      Object.assign(out, {
        captain: args.captain.toLowerCase(),
        replayHash: args.replayHash,
        homeDelivered: Number(args.homeDelivered),
        homeTurns: Number(args.homeTurns),
        awayDelivered: Number(args.awayDelivered),
        awayTurns: Number(args.awayTurns),
      });
      break;
    case 'Accepted':
      Object.assign(out, {
        outcome: ['None', 'HomeWin', 'AwayWin', 'Draw'][Number(args.outcome)] ?? 'None',
        replayHash: args.replayHash,
        homeDelivered: Number(args.homeDelivered),
        homeTurns: Number(args.homeTurns),
        awayDelivered: Number(args.awayDelivered),
        awayTurns: Number(args.awayTurns),
      });
      break;
    case 'Disputed':
      Object.assign(out, { homeReport: args.homeReport, awayReport: args.awayReport });
      break;
    case 'Expired':
      break;
  }
  return out;
}
