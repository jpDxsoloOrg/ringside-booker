/**
 * Templated text: turns the engine's content key and params into words, from the catalogs that
 * features register (`catalog.ts`).
 *
 * Two ways to write it:
 *
 * - `renderTemplatedText(text)` gives a plain string, filling `{param}` with the raw value. The rival
 *   desk's decision lines use this; a key no catalog knows renders as the key itself.
 * - `renderTemplatedText(text, { names, renderEntityLink })` gives React nodes, and
 *   `templatedTextToString(text, { names })` the same words as a string (for the ticker, aria
 *   labels and the document title). These understand `{param:format}` and entity names, and a key
 *   no catalog knows renders as "[missing text]".
 *
 * Formats: `date` (a game date, long: "Monday, January 5, 2026"), `count` ("1,200"), `ordinal`
 * ("10th") and `money` (integer cents: "$12,000"). With no format, a param whose value is an id
 * the `names` know, or ids joined by commas, renders as the names joined "A, B and C", each drawn
 * through `renderEntityLink`; anything else renders as written.
 *
 * Design: README.md in this folder.
 */
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { cents, isGameDate, kindOfId, NO_LONGER_IN_RECORDS } from '@ringside/engine';
import type { EntityKind } from '@ringside/engine';
import { formatGameDate, formatMoney, formatNumber } from '@/components/format';
import type { EntityLinkRenderer } from '@/components/Trace/rows/rowTypes';
import { textFor } from './catalog';
import type { TemplatedText, TextParams } from './catalog';

export { registerTextCatalog, textFor, textNamespaceOf } from './catalog';
export type { TemplatedText, TextCatalog, TextParams, TextTemplate } from './catalog';

/** What a key no catalog knows shows, in the rich renderer. */
export const MISSING_TEXT = '[missing text]';

/** The formats a placeholder can ask for: `{param:format}`. */
export const TEXT_FORMATS = ['date', 'count', 'ordinal', 'money'] as const;
export type TextFormat = (typeof TEXT_FORMATS)[number];

/** The name of every id a text may mention, keyed by id: the news queries' `names`. */
export type TextNames = Readonly<
  Record<string, { readonly kind: EntityKind; readonly name: string }>
>;

export interface RenderTemplatedTextOptions {
  readonly names: TextNames;
  /** Draws one entity's name. Plain text when left out. */
  readonly renderEntityLink?: EntityLinkRenderer | undefined;
}

export interface TemplatedTextToStringOptions {
  readonly names: TextNames;
}

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;
const FORMATTED_PLACEHOLDER = /\{([A-Za-z0-9_]+)(?::([A-Za-z]+))?\}/g;

/** Fills `{param}` placeholders with raw values; a placeholder with no param stays as written. */
export function fillTemplate(template: string, params: TextParams): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/** One entity a text names. */
interface NamedEntity {
  readonly id: string;
  /** Null for an id the names do not know: it is drawn as plain text. */
  readonly kind: EntityKind | null;
  readonly name: string;
}

type Piece =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'entities'; readonly entities: readonly NamedEntity[] };

function isTextFormat(value: string): value is TextFormat {
  return TEXT_FORMATS.some((format) => format === value);
}

function asNumber(value: string | number): number | null {
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st". */
export function ordinalText(value: number): string {
  const whole = Math.trunc(value);
  const lastTwo = Math.abs(whole) % 100;
  const last = Math.abs(whole) % 10;
  let suffix = 'th';
  if (lastTwo < 11 || lastTwo > 13) {
    if (last === 1) suffix = 'st';
    else if (last === 2) suffix = 'nd';
    else if (last === 3) suffix = 'rd';
  }
  return `${formatNumber(whole)}${suffix}`;
}

/** A value in a format. A value the format cannot read is shown as written. */
function formatted(value: string | number, format: TextFormat): string {
  if (format === 'date') {
    return isGameDate(value) ? formatGameDate(value, 'long') : String(value);
  }
  const number = asNumber(value);
  if (number === null) return String(value);
  switch (format) {
    case 'count':
      return formatNumber(number);
    case 'ordinal':
      return ordinalText(number);
    case 'money':
      return formatMoney(cents(Math.round(number)));
  }
}

/**
 * The entities a value names when every comma-separated part is an id (named by `names`, or an id
 * whose row is gone), else null: the value is shown as written.
 */
function entitiesOf(value: string | number, names: TextNames): NamedEntity[] | null {
  if (typeof value !== 'string') return null;
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) return null;
  const entities: NamedEntity[] = [];
  for (const id of parts) {
    const named = Object.hasOwn(names, id) ? names[id] : undefined;
    if (named !== undefined) {
      entities.push({ id, kind: named.kind, name: named.name });
    } else if (kindOfId(id) !== null) {
      entities.push({ id, kind: null, name: NO_LONGER_IN_RECORDS });
    } else {
      return null;
    }
  }
  return entities;
}

/** The items with their separators: "A", "A and B", "A, B and C". */
function joinedNames<Item>(items: readonly Item[]): (Item | string)[] {
  const joined: (Item | string)[] = [];
  items.forEach((item, index) => {
    if (index > 0) joined.push(index === items.length - 1 ? ' and ' : ', ');
    joined.push(item);
  });
  return joined;
}

function piecesOf(template: string, params: TextParams, names: TextNames): Piece[] {
  const pieces: Piece[] = [];
  let text = '';
  let last = 0;
  for (const match of template.matchAll(FORMATTED_PLACEHOLDER)) {
    const [whole, name = '', format] = match;
    text += template.slice(last, match.index);
    last = match.index + whole.length;
    const value = params[name];
    if (value === undefined) {
      text += whole;
    } else if (format !== undefined) {
      text += isTextFormat(format) ? formatted(value, format) : String(value);
    } else {
      const entities = entitiesOf(value, names);
      if (entities === null) {
        text += String(value);
      } else {
        if (text !== '') pieces.push({ kind: 'text', text });
        text = '';
        pieces.push({ kind: 'entities', entities });
      }
    }
  }
  text += template.slice(last);
  if (text !== '') pieces.push({ kind: 'text', text });
  return pieces;
}

/** The pieces of a text, or null when no catalog has its key. */
function textPieces(text: TemplatedText, names: TextNames): Piece[] | null {
  const template = textFor(text.key);
  if (template === undefined) return null;
  const source = typeof template === 'string' ? template : template(text.params);
  return piecesOf(source, text.params, names);
}

/**
 * A text in English as one string, names included: for the ticker, aria labels and the document
 * title. A key no catalog knows reads "[missing text]".
 */
export function templatedTextToString(
  text: TemplatedText,
  { names }: TemplatedTextToStringOptions,
): string {
  const pieces = textPieces(text, names);
  if (pieces === null) return MISSING_TEXT;
  return pieces
    .map((piece) =>
      piece.kind === 'text'
        ? piece.text
        : joinedNames(piece.entities.map((entity) => entity.name)).join(''),
    )
    .join('');
}

function entityNode(entity: NamedEntity, renderEntityLink: EntityLinkRenderer | undefined) {
  if (entity.kind === null || renderEntityLink === undefined) return entity.name;
  return renderEntityLink({ kind: entity.kind, id: entity.id }, entity.name);
}

function renderPieces(
  pieces: readonly Piece[],
  renderEntityLink: EntityLinkRenderer | undefined,
): ReactNode {
  return pieces.map((piece, index) => (
    <Fragment key={index}>
      {piece.kind === 'text'
        ? piece.text
        : joinedNames(piece.entities).map((part, partIndex) => (
            <Fragment key={partIndex}>
              {typeof part === 'string' ? part : entityNode(part, renderEntityLink)}
            </Fragment>
          ))}
    </Fragment>
  ));
}

/** A text in English as a plain string, with raw values. A key no catalog knows shows the key. */
export function renderTemplatedText(text: TemplatedText): string;
/**
 * A text in English with formats and names drawn through `renderEntityLink`. A key no catalog
 * knows shows "[missing text]", marked with `data-missing-key`.
 */
export function renderTemplatedText(
  text: TemplatedText,
  options: RenderTemplatedTextOptions,
): ReactNode;
export function renderTemplatedText(
  text: TemplatedText,
  options?: RenderTemplatedTextOptions,
): ReactNode {
  if (options === undefined) {
    const template = textFor(text.key);
    if (template === undefined) return text.key;
    return typeof template === 'string'
      ? fillTemplate(template, text.params)
      : template(text.params);
  }
  const pieces = textPieces(text, options.names);
  if (pieces === null) return <span data-missing-key={text.key}>{MISSING_TEXT}</span>;
  return <>{renderPieces(pieces, options.renderEntityLink)}</>;
}
