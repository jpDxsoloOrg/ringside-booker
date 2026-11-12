/**
 * The game's icon names and the Lucide glyph each one draws.
 *
 * Screens only ever pass an `IconName`, never a Lucide component, so the icon set can be swapped
 * later by changing this one file. Every glyph is a named import, so the bundle carries only the
 * icons mapped here and not the whole library.
 */
import {
  ArrowDown,
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowUp,
  ArrowUpNarrowWide,
  Bandage,
  Banknote,
  BookOpen,
  BuildingComplex,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CircleX,
  CircleQuestionMark,
  ClipboardList,
  Download,
  Ellipsis,
  FastForward,
  FilePenLine,
  FileText,
  FlaskConical,
  GripVertical,
  House,
  Inbox,
  Info,
  LayoutDashboard,
  Layers,
  Link,
  Lock,
  LockOpen,
  LogOut,
  Menu,
  MessageCircleQuestionMark,
  Minus,
  Network,
  Newspaper,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  RotateCcw,
  RotateCcwClock,
  Search,
  Settings,
  Square,
  Star,
  StepForward,
  Ticket,
  Trash,
  TriangleAlert,
  Trophy,
  Tv,
  Upload,
  UserSearch,
  Users,
  Video,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** The main navigation destinations. */
export const NAV_ICON_NAMES = [
  'office',
  'roster',
  'booking',
  'calendar',
  'titles',
  'storylines',
  'contracts',
  'finance',
  'inbox',
  'settings',
  'lab',
] as const;

/** States shown next to a value. Each one sits beside a sign or a label, never colour alone. */
export const STATE_ICON_NAMES = [
  'up',
  'down',
  'flat',
  'injured',
  'warning',
  'check',
  'live',
  'error',
  'lock',
  'unlock',
] as const;

/** Things the player does. */
export const ACTION_ICON_NAMES = [
  'play',
  'pause',
  'next-day',
  'add',
  'decrease',
  'reset',
  'drag-handle',
  'info',
  'why',
  'edit',
] as const;

/** Interface chrome and the other screens and objects. */
export const GENERAL_ICON_NAMES = [
  'menu',
  'close',
  'back',
  'chevron-left',
  'chevron-right',
  'chevron-down',
  'more',
  'star',
  'help',
  'fast-forward',
  'stop',
  'upload',
  'download',
  'trash',
  'search',
  'sort-asc',
  'sort-desc',
  'log-out',
  'home',
  'newspaper',
  'users',
  'user-search',
  'building',
  'history',
  'clipboard',
  'ticket',
  'trophy',
  'book',
  'link',
  'bracket',
  'layers',
  'money',
  'file-text',
  'tv',
  'video',
] as const;

export const ICON_NAMES = [
  ...NAV_ICON_NAMES,
  ...STATE_ICON_NAMES,
  ...ACTION_ICON_NAMES,
  ...GENERAL_ICON_NAMES,
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export interface IconGroup {
  readonly id: 'nav' | 'states' | 'actions' | 'general';
  readonly label: string;
  readonly names: readonly IconName[];
}

/** The names in the order and groups the gallery shows them. Together they are every name. */
export const ICON_GROUPS: readonly IconGroup[] = [
  { id: 'nav', label: 'Navigation', names: NAV_ICON_NAMES },
  { id: 'states', label: 'States', names: STATE_ICON_NAMES },
  { id: 'actions', label: 'Actions', names: ACTION_ICON_NAMES },
  { id: 'general', label: 'General', names: GENERAL_ICON_NAMES },
];

/** The Lucide glyph behind each name. A name with no glyph, or a glyph with no name, fails to compile. */
export const ICON_GLYPHS: Readonly<Record<IconName, LucideIcon>> = {
  office: LayoutDashboard,
  roster: Users,
  booking: ClipboardList,
  calendar: CalendarDays,
  titles: Trophy,
  storylines: BookOpen,
  contracts: FilePenLine,
  finance: CircleDollarSign,
  inbox: Inbox,
  settings: Settings,
  lab: FlaskConical,

  up: ArrowUp,
  down: ArrowDown,
  flat: Minus,
  injured: Bandage,
  warning: TriangleAlert,
  check: Check,
  live: Radio,
  error: CircleX,
  lock: Lock,
  unlock: LockOpen,

  play: Play,
  pause: Pause,
  'next-day': StepForward,
  add: Plus,
  decrease: Minus,
  reset: RotateCcw,
  'drag-handle': GripVertical,
  info: Info,
  why: MessageCircleQuestionMark,
  edit: Pencil,

  menu: Menu,
  close: X,
  back: ArrowLeft,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  more: Ellipsis,
  star: Star,
  help: CircleQuestionMark,
  'fast-forward': FastForward,
  stop: Square,
  upload: Upload,
  download: Download,
  trash: Trash,
  search: Search,
  'sort-asc': ArrowUpNarrowWide,
  'sort-desc': ArrowDownWideNarrow,
  'log-out': LogOut,
  home: House,
  newspaper: Newspaper,
  users: Users,
  'user-search': UserSearch,
  building: BuildingComplex,
  history: RotateCcwClock,
  clipboard: ClipboardList,
  ticket: Ticket,
  trophy: Trophy,
  book: BookOpen,
  link: Link,
  bracket: Network,
  layers: Layers,
  money: Banknote,
  'file-text': FileText,
  tv: Tv,
  video: Video,
};

/** True when `value` names an icon in the set. */
export function isIconName(value: unknown): value is IconName {
  return typeof value === 'string' && (ICON_NAMES as readonly string[]).includes(value);
}
