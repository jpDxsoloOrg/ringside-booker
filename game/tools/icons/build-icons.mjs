#!/usr/bin/env node
// Builds the game's icon set (UNITY-11) from Lucide (ISC licence, see game/docs/licenses/THIRD-PARTY-NOTICES.txt).
//
// Reads each icon's node list from an installed lucide-react package (the web app's dependency),
// turns every element (path, circle, ellipse, rect, line, polyline, polygon) into SVG path data and
// writes one line per game icon name: "<name>\t<path data>" to
// game/Assets/UI/Design/Resources/Design/Icons.txt. The game strokes that path data with Painter2D
// (RingsideBooker.UI.Design.Icon), so icons stay sharp at every UI scale and take the text colour.
//
// Usage: node game/tools/icons/build-icons.mjs [path/to/node_modules/lucide-react]
// Default package path: ../../../node_modules/lucide-react (the repo root's node_modules).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const gameDir = resolve(here, '..', '..');
const pkg = resolve(process.argv[2] ?? join(gameDir, '..', 'node_modules', 'lucide-react'));
const out = join(gameDir, 'Assets', 'UI', 'Design', 'Resources', 'Design', 'Icons.txt');

/** Game icon name -> Lucide icon file. Names match the web's IconName where the web has one. */
const ICONS = {
  // Navigation (web NAV_ICON_NAMES + the other sidebar entries).
  office: 'layout-dashboard',
  roster: 'users',
  booking: 'clipboard-list',
  calendar: 'calendar-days',
  titles: 'trophy',
  storylines: 'book-open',
  contracts: 'file-pen-line',
  finance: 'circle-dollar-sign',
  inbox: 'inbox',
  settings: 'settings',
  lab: 'flask-conical',
  newspaper: 'newspaper',
  'user-search': 'user-search',
  building: 'building-complex',
  history: 'rotate-ccw-clock',
  link: 'link',
  bracket: 'network',
  layers: 'layers',
  money: 'banknote',
  tv: 'tv',
  video: 'video',
  'log-out': 'log-out',
  home: 'house',
  // States.
  up: 'arrow-up',
  down: 'arrow-down',
  flat: 'minus',
  'trend-up': 'trending-up',
  'trend-down': 'trending-down',
  injured: 'bandage',
  warning: 'triangle-alert',
  problem: 'octagon-alert',
  check: 'check',
  'check-circle': 'circle-check',
  live: 'radio',
  error: 'circle-x',
  lock: 'lock',
  unlock: 'lock-open',
  info: 'info',
  hot: 'flame',
  morale: 'heart',
  momentum: 'zap',
  tired: 'hourglass',
  // Actions.
  play: 'play',
  pause: 'pause',
  'next-day': 'step-forward',
  'fast-forward': 'fast-forward',
  stop: 'square',
  add: 'plus',
  decrease: 'minus',
  reset: 'rotate-ccw',
  'drag-handle': 'grip-vertical',
  why: 'circle-question-mark',
  edit: 'pencil',
  search: 'search',
  trash: 'trash-2',
  upload: 'upload',
  download: 'download',
  'user-plus': 'user-plus',
  'user-minus': 'user-minus',
  filter: 'list-filter',
  columns: 'columns-3',
  'sort-asc': 'arrow-up-narrow-wide',
  'sort-desc': 'arrow-down-wide-narrow',
  sort: 'arrow-up-down',
  // Chrome.
  menu: 'menu',
  close: 'x',
  back: 'arrow-left',
  'chevron-left': 'chevron-left',
  'chevron-right': 'chevron-right',
  'chevron-down': 'chevron-down',
  'chevron-up': 'chevron-up',
  more: 'ellipsis',
  'sidebar-close': 'panel-left-close',
  'sidebar-open': 'panel-left-open',
  bell: 'bell',
  // Objects.
  star: 'star',
  help: 'circle-question-mark',
  users: 'users',
  user: 'user-round',
  clipboard: 'clipboard-list',
  ticket: 'ticket',
  trophy: 'trophy',
  crown: 'crown',
  medal: 'medal',
  versus: 'swords',
  promo: 'mic',
  megaphone: 'megaphone',
  venue: 'map-pin',
  clock: 'clock',
  sparkles: 'sparkles',
  eye: 'eye',
  gauge: 'gauge',
  activity: 'activity',
  handshake: 'handshake',
  wallet: 'wallet',
  chart: 'chart-no-axes-column',
  'file-text': 'file-text',
  map: 'map',
};

const num = (value) => Number(value ?? 0);
const fmt = (value) => Number(num(value).toFixed(3)).toString();

function points(list) {
  return String(list)
    .trim()
    .split(/[\s,]+/)
    .map(Number);
}

function elementToPath(tag, attrs) {
  switch (tag) {
    case 'path': {
      const d = String(attrs.d).trim();
      if (!d.startsWith('m')) return d;
      // A path's first moveto is absolute even when written "m", but the coordinate pairs after it
      // stay relative line-tos. Once paths are concatenated, spell that out: "m9 18 6-6" -> "M9 18l6-6".
      const number = /^[\s,]*(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/i;
      let rest = d.slice(1);
      const x = rest.match(number);
      rest = rest.slice(x[0].length);
      const y = rest.match(number);
      rest = rest.slice(y[0].length);
      const tail = rest.trim();
      const implicit = tail.length > 0 && !/^[a-df-z]/i.test(tail);
      return `M${x[1]} ${y[1]}${implicit ? `l${tail.replace(/^,/, '')}` : rest}`;
    }
    case 'circle':
    case 'ellipse': {
      const cx = num(attrs.cx);
      const cy = num(attrs.cy);
      const rx = num(attrs.r ?? attrs.rx);
      const ry = num(attrs.r ?? attrs.ry);
      return `M${fmt(cx - rx)} ${fmt(cy)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)}Z`;
    }
    case 'rect': {
      const x = num(attrs.x);
      const y = num(attrs.y);
      const w = num(attrs.width);
      const h = num(attrs.height);
      const rx = Math.min(num(attrs.rx ?? attrs.ry), w / 2);
      const ry = Math.min(num(attrs.ry ?? attrs.rx), h / 2);
      if (!rx && !ry) return `M${fmt(x)} ${fmt(y)}H${fmt(x + w)}V${fmt(y + h)}H${fmt(x)}Z`;
      return [
        `M${fmt(x + rx)} ${fmt(y)}`,
        `H${fmt(x + w - rx)}`,
        `A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + w)} ${fmt(y + ry)}`,
        `V${fmt(y + h - ry)}`,
        `A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + w - rx)} ${fmt(y + h)}`,
        `H${fmt(x + rx)}`,
        `A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x)} ${fmt(y + h - ry)}`,
        `V${fmt(y + ry)}`,
        `A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(x + rx)} ${fmt(y)}`,
        'Z',
      ].join('');
    }
    case 'line':
      return `M${fmt(attrs.x1)} ${fmt(attrs.y1)}L${fmt(attrs.x2)} ${fmt(attrs.y2)}`;
    case 'polyline':
    case 'polygon': {
      const values = points(attrs.points);
      let d = `M${fmt(values[0])} ${fmt(values[1])}`;
      for (let i = 2; i + 1 < values.length; i += 2)
        d += `L${fmt(values[i])} ${fmt(values[i + 1])}`;
      return tag === 'polygon' ? `${d}Z` : d;
    }
    default:
      throw new Error(`unsupported element <${tag}>`);
  }
}

function readNodes(file) {
  const source = readFileSync(file, 'utf8');
  // Renamed icons are re-exports of the new file: follow them.
  const alias = source.match(/export \{ default \} from '\.\/([a-z0-9-]+\.mjs)'/);
  if (alias) return readNodes(join(dirname(file), alias[1]));
  const match = source.match(/const __iconData = (\{[\s\S]*?\n\});/);
  if (!match) throw new Error(`no icon data in ${file}`);
  // The icon data is a plain object literal: { name, size, node: [[tag, attributes], ...] }.
  return new Function(`return ${match[1]};`)().node;
}

if (!existsSync(pkg)) {
  console.error(`lucide-react not found at ${pkg} (pass its path)`);
  process.exit(2);
}
const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version;
const lines = [
  `# Lucide ${version} (ISC). Generated by game/tools/icons/build-icons.mjs; do not edit.`,
];
for (const [name, lucide] of Object.entries(ICONS)) {
  const nodes = readNodes(join(pkg, 'dist', 'esm', 'icons', `${lucide}.mjs`));
  const d = nodes.map(([tag, attrs]) => elementToPath(tag, attrs)).join('');
  lines.push(`${name}\t${d}`);
}
writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`wrote ${Object.keys(ICONS).length} icons (Lucide ${version}) to ${out}`);
