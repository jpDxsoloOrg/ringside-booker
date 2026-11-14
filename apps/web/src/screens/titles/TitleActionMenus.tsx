import { useLocation, useNavigate } from 'react-router-dom';
import type { TitleCardRow } from '@ringside/engine';
import { titleLinkState } from '@/app/entityLinks';
import { routes } from '@/app/routes';
import { Button, IconButton } from '@/components/Button';
import { DropdownMenu } from '@/components/DropdownMenu';
import type { DropdownMenuAction } from '@/components/DropdownMenu';
import type { IconName } from '@/components/Icon';
import { useIsMobile } from '@/styles/useMediaQuery';
import styles from './TitleActions.module.css';
import { TITLE_ACTION_LABELS, titleRowActions } from './useTitleActions';
import type { TitleActionsState, TitleRowAction } from './useTitleActions';

const ACTION_ICONS: Readonly<Record<TitleRowAction, IconName>> = {
  edit: 'edit',
  award: 'trophy',
  vacate: 'close',
  retire: 'lock',
  reactivate: 'unlock',
};

/** The actions that end a reign or a title's run: shown in the danger colour. */
const DANGER_ACTIONS: ReadonlySet<TitleRowAction> = new Set(['vacate', 'retire']);

function menuItem(
  action: TitleRowAction,
  row: TitleCardRow,
  actions: TitleActionsState,
): DropdownMenuAction {
  return {
    kind: 'item',
    id: action,
    label: TITLE_ACTION_LABELS[action],
    icon: ACTION_ICONS[action],
    tone: DANGER_ACTIONS.has(action) ? 'danger' : 'default',
    onSelect: () => {
      actions.openAction(action, row);
    },
  };
}

/** "Actions for the Test Heavyweight Title". */
export function titleMenuLabel(row: Pick<TitleCardRow, 'name'>): string {
  return `Actions for the ${row.name}`;
}

/**
 * The menu on one of the player's own title cards: Edit, Award, Vacate (when held), Retire, or
 * Reactivate for a retired title, then Open. Nothing at all for a title the player doesn't run.
 */
export function TitleCardMenu({
  row,
  actions,
}: {
  readonly row: TitleCardRow;
  readonly actions: TitleActionsState;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const available = titleRowActions(row);
  if (available.length === 0) return null;
  return (
    <DropdownMenu
      trigger={<IconButton icon="more" size="sm" label={titleMenuLabel(row)} />}
      items={[
        ...available.map((action) => menuItem(action, row, actions)),
        { kind: 'separator', id: 'separator' },
        {
          kind: 'item',
          id: 'open',
          label: 'Open',
          icon: 'chevron-right',
          onSelect: () => {
            navigate(routes.game.title(row.titleId), { state: titleLinkState(location) });
          },
        },
      ]}
    />
  );
}

/**
 * The title page's actions under its header, for a title the player runs: Edit, Award, Vacate
 * when held and Retire, or Reactivate when retired. On a phone the first stays a button and the
 * rest go into a "More" menu, so the bar never wraps into a wall of buttons. Nothing for anyone
 * else's title.
 */
export function TitleActionBar({
  row,
  actions,
}: {
  readonly row: TitleCardRow;
  readonly actions: TitleActionsState;
}) {
  const isMobile = useIsMobile();
  const available = titleRowActions(row);
  if (available.length === 0) return null;
  const [first, ...rest] = available;
  const shownAsButtons = isMobile && first !== undefined ? [first] : available;
  const inMenu = isMobile ? rest : [];
  return (
    <div className={styles['actionBar']} role="group" aria-label={`Change the ${row.name}`}>
      {shownAsButtons.map((action) => (
        <Button
          key={action}
          iconStart={ACTION_ICONS[action]}
          variant="secondary"
          onClick={() => {
            actions.openAction(action, row);
          }}
        >
          {TITLE_ACTION_LABELS[action]}
        </Button>
      ))}
      {inMenu.length > 0 && (
        <DropdownMenu
          align="start"
          trigger={
            <Button iconEnd="chevron-down" variant="secondary">
              More
            </Button>
          }
          label={`More actions for the ${row.name}`}
          items={inMenu.map((action) => menuItem(action, row, actions))}
        />
      )}
    </div>
  );
}
