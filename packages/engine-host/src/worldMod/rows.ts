/**
 * Rows of a workshop world mod's SQLite tables, as the game hands them over: one JSON object per
 * row, column name to value. SQLite is loosely typed (a column declared INTEGER may hold text, and
 * empty text often stands for "none"), so every read goes through these helpers, which turn
 * whatever is stored into the type the converter wants or a fallback.
 */

import { isGameDate } from '@ringside/engine';
import type { GameDate } from '@ringside/engine';

/** One table row: column name to the stored value (number, text or null). */
export type ModRow = Readonly<Record<string, unknown>>;

/** Every table the game read, by table name: each should be an array of row objects. */
export type ModTables = Readonly<Record<string, unknown>>;

function isRow(value: unknown): value is ModRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when the game passed table `name` (even an empty one). */
export function hasTable(tables: ModTables, name: string): boolean {
  return Array.isArray(tables[name]);
}

/** The rows of table `name`; anything that is not a row object is skipped. */
export function tableRows(tables: ModTables, name: string): readonly ModRow[] {
  const value = tables[name];
  if (!Array.isArray(value)) return [];
  const list: readonly unknown[] = value;
  const rows: ModRow[] = [];
  for (const entry of list) if (isRow(entry)) rows.push(entry);
  return rows;
}

/** Text, trimmed; null for null, empty text or a non-text value that is not a number. */
export function text(row: ModRow, column: string): string | null {
  const value = row[column];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** A finite number; numeric text counts. Null when there is none. */
export function num(row: ModRow, column: string): number | null {
  const value = row[column];
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A whole number, or null. */
export function int(row: ModRow, column: string): number | null {
  const value = num(row, column);
  return value === null ? null : Math.trunc(value);
}

/** A positive id (the mods use 0 or null for "none"). */
export function id(row: ModRow, column: string): number | null {
  const value = int(row, column);
  return value !== null && value > 0 ? value : null;
}

/** A flag: any non-zero number or the text "true"/"1" is true. */
export function flag(row: ModRow, column: string): boolean {
  const value = row[column];
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    return lowered === 'true' || (lowered !== '' && lowered !== 'false' && Number(lowered) !== 0);
  }
  return false;
}

/** An ISO date (`YYYY-MM-DD`, extra time text cut off), or null. */
export function date(row: ModRow, column: string): GameDate | null {
  const value = text(row, column);
  if (value === null) return null;
  const head = value.slice(0, 10);
  return isGameDate(head) ? head : null;
}

/** Clamps to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Rounds to one decimal place. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Cuts text to `max` characters (whole code points). */
export function cut(value: string, max: number): string {
  const points = Array.from(value);
  return points.length <= max ? value : points.slice(0, max).join('').trimEnd();
}
