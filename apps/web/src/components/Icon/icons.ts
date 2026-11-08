/**
 * The game's small inline icon set. Each icon is a list of SVG path strings drawn on a 24 by 24
 * grid as 2px rounded strokes (no fills), so every icon takes its colour from `currentColor` and
 * sits on the same visual weight as the text around it.
 *
 * Call sites only ever pass an `IconName`, so the whole set can be swapped for a fuller one later
 * without touching a screen.
 */

export const ICON_NAMES = [
  'menu',
  'close',
  'chevron-right',
  'chevron-down',
  'more',
  'calendar',
  'money',
  'star',
  'help',
  'play',
  'fast-forward',
  'stop',
  'upload',
  'download',
  'trash',
  'settings',
  'search',
  'sort-asc',
  'sort-desc',
  'home',
  'inbox',
  'newspaper',
  'users',
  'building',
  'history',
  'clipboard',
  'ticket',
  'trophy',
  'book',
  'link',
  'bracket',
  'layers',
  'file-text',
  'tv',
  'video',
  'log-out',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** A small dot drawn as a ring of radius 1 with a 2px stroke, which reads as a filled dot. */
function dot(centreX: number, centreY: number): string {
  return `M${String(centreX - 1)} ${String(centreY)}a1 1 0 1 0 2 0a1 1 0 1 0 -2 0`;
}

/** A circle as a path, so every icon is made of the same element. */
function circle(centreX: number, centreY: number, radius: number): string {
  const start = `M${String(centreX - radius)} ${String(centreY)}`;
  const arc = `a${String(radius)} ${String(radius)} 0 1 0 ${String(radius * 2)} 0`;
  const back = `a${String(radius)} ${String(radius)} 0 1 0 ${String(-radius * 2)} 0`;
  return `${start}${arc}${back}`;
}

export const ICON_PATHS: Readonly<Record<IconName, readonly string[]>> = {
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  'chevron-right': ['M9 5l7 7-7 7'],
  'chevron-down': ['M5 9l7 7 7-7'],
  more: [dot(5, 12), dot(12, 12), dot(19, 12)],
  calendar: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v5', 'M16 3v5'],
  money: ['M3 7h18v10H3z', circle(12, 12, 2), 'M6.5 12h.01', 'M17.5 12h.01'],
  star: ['M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z'],
  help: [circle(12, 12, 9), 'M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.6', 'M12 17h.01'],
  play: ['M7 4.5v15L19 12z'],
  'fast-forward': ['M3.5 6v12l8-6z', 'M12.5 6v12l8-6z'],
  stop: ['M6 6h12v12H6z'],
  upload: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 20h16'],
  download: ['M12 4v12', 'M7 11l5 5 5-5', 'M4 20h16'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
  settings: [
    'M4 6h9',
    'M17 6h3',
    'M15 4v4',
    'M4 12h3',
    'M11 12h9',
    'M9 10v4',
    'M4 18h11',
    'M19 18h1',
    'M17 16v4',
  ],
  search: [circle(11, 11, 6.5), 'M16 16l4.5 4.5'],
  'sort-asc': ['M7 20V4', 'M3.5 7.5 7 4l3.5 3.5', 'M14 7h3', 'M14 12h5', 'M14 17h7'],
  'sort-desc': ['M7 4v16', 'M3.5 16.5 7 20l3.5-3.5', 'M14 7h7', 'M14 12h5', 'M14 17h3'],
  home: ['M3 11l9-7 9 7', 'M5 9.5V20h14V9.5', 'M10 20v-6h4v6'],
  inbox: ['M3 13l3-8h12l3 8v6H3z', 'M3 13h5l1 3h6l1-3h5'],
  newspaper: [
    'M4 5h13v14H6a2 2 0 0 1-2-2z',
    'M17 9h3v8a2 2 0 0 1-2 2',
    'M7 9h7',
    'M7 13h7',
    'M7 16h4',
  ],
  users: [
    circle(9, 8, 3.5),
    'M2.5 20a6.5 6.5 0 0 1 13 0',
    'M16 4.5a3.5 3.5 0 0 1 0 7',
    'M18 14a5 5 0 0 1 3.5 6',
  ],
  building: ['M4 20V4h10v16', 'M14 9h6v11', 'M2 20h20', 'M7 8h4', 'M7 12h4', 'M7 16h4'],
  history: ['M3 12a9 9 0 1 0 2.6-6.4', 'M3 4v4h4', 'M12 8v4l3 2'],
  clipboard: ['M8 3.5h8v3H8z', 'M8 5H5v15.5h14V5h-3', 'M8 11h8', 'M8 15h5'],
  ticket: ['M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z', 'M14 7v10'],
  trophy: [
    'M8 4h8v5a4 4 0 0 1-8 0z',
    'M8 6H4.5A3.5 3.5 0 0 0 8 10',
    'M16 6h3.5A3.5 3.5 0 0 1 16 10',
    'M12 13v4',
    'M8 20.5h8',
    'M9.5 17h5v3.5',
  ],
  book: ['M5 4h14v16H7a2 2 0 0 1-2-2z', 'M5 18a2 2 0 0 1 2-2h12', 'M9 8h6'],
  link: [
    'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1',
    'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  ],
  bracket: ['M3 5h5v14H3', 'M8 12h5', 'M13 8h5v8h-5', 'M18 12h3'],
  layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5'],
  'file-text': ['M6 3h9l4 4v14H6z', 'M14 3v5h5', 'M9 12h7', 'M9 16h7'],
  tv: ['M3 7h18v12H3z', 'M8 3l4 4 4-4'],
  video: ['M3 7h12v10H3z', 'M15 11l6-4v10l-6-4'],
  'log-out': ['M14 4h5v16h-5', 'M10 8l-4 4 4 4', 'M6 12h10'],
};

/** True when `value` names an icon in the set. */
export function isIconName(value: unknown): value is IconName {
  return typeof value === 'string' && (ICON_NAMES as readonly string[]).includes(value);
}
