import { addMonths, cents, parseGameDate } from '@ringside/engine';
import type { Cents, GameDate } from '@ringside/engine';

/** A roster row as a screen might get it from an engine query. Gallery data only. */
export interface GalleryWorker {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  /** 0 to 100. */
  readonly popularity: number;
  /** -10 to +10. */
  readonly momentum: number;
  readonly age: number;
  /** `null` for a worker with no contract. */
  readonly contractEnd: GameDate | null;
  readonly weeklyWage: Cents;
}

export const GALLERY_WORKER_COUNT = 40;

const ROLES: readonly string[] = [
  'Wrestler',
  'Wrestler',
  'Wrestler',
  'Manager',
  'Wrestler',
  'Referee',
  'Commentator',
];

const ROSTER_DATE = parseGameDate('2031-01-01');

/** Builds worker `number` (1-based). Values are spread with fixed arithmetic, never randomness. */
function makeWorker(number: number): GalleryWorker {
  const hasContract = number % 9 !== 0;
  return {
    id: `wrk_${String(number).padStart(2, '0')}`,
    name: `Worker ${String(number)}`,
    role: ROLES[number % ROLES.length] ?? 'Wrestler',
    popularity: (number * 37) % 101,
    momentum: ((number * 13) % 21) - 10,
    age: 19 + ((number * 7) % 28),
    contractEnd: hasContract ? addMonths(ROSTER_DATE, ((number * 5) % 36) + 1) : null,
    // Dollars per week in steps of 250, stored as cents.
    weeklyWage: cents((((number * 29) % 40) + 2) * 250 * 100),
  };
}

/** Forty placeholder workers for the DataTable demo. */
export const galleryWorkers: readonly GalleryWorker[] = Array.from(
  { length: GALLERY_WORKER_COUNT },
  (_, index) => makeWorker(index + 1),
);
