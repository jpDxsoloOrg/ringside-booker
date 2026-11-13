import { useState } from 'react';
import type { AipRulesView, AiShortcutRuleView } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { classNames } from '@/components/classNames';
import { formatNumber } from '@/components/format';
import { Popover } from '@/components/Popover';
import { Sheet } from '@/components/Sheet';
import { useIsMobile } from '@/styles/useMediaQuery';
import styles from './RivalRules.module.css';

/** The rule under the list: who the shortcuts apply to and where they are set. */
export const RIVAL_RULES_FOOTER =
  'Rival rules apply only to promotions run by the computer. Set at new game (Level playing field).';

const TITLE = 'Rival rules';

/** The chip's words: "Rival rules: 5 on", or "Level playing field" when nothing applies. */
export function rivalRulesChipText(rules: AipRulesView): string {
  if (rules.levelPlayingField) return 'Level playing field';
  const inForce = rules.shortcuts.filter((shortcut) => shortcut.inForce).length;
  return `Rival rules: ${formatNumber(inForce)} on`;
}

/** "On", "Off", or the score bonus as "+3". */
export function shortcutStateText(shortcut: AiShortcutRuleView): string {
  if (!shortcut.inForce) return 'Off';
  if (shortcut.kind === 'points' && typeof shortcut.value === 'number') {
    return `+${formatNumber(shortcut.value)}`;
  }
  return 'On';
}

interface RivalRulesListProps {
  readonly rules: AipRulesView;
}

/** Every shortcut with its state, what it does, its setting and whether anything acts on it. */
export function RivalRulesList({ rules }: RivalRulesListProps) {
  return (
    <div className={styles['rules']}>
      {rules.levelPlayingField && (
        <p className={styles['level']}>
          This game was started with the level playing field: rivals play by the full rules.
        </p>
      )}
      <ul className={styles['list']} aria-label="Shortcuts">
        {rules.shortcuts.map((shortcut) => (
          <li key={shortcut.key} className={styles['item']}>
            <span className={styles['itemHead']}>
              <span className={styles['label']}>{shortcut.label}</span>
              <Badge tone={shortcut.inForce ? 'data' : 'neutral'}>
                {shortcutStateText(shortcut)}
              </Badge>
            </span>
            <span className={styles['description']}>
              {shortcut.inForce || rules.levelPlayingField
                ? shortcut.description
                : shortcut.offText}
            </span>
            <code className={styles['key']}>{shortcut.key}</code>
            {shortcut.consumers.length === 0 && (
              <span className={styles['pending']}>
                {`Takes effect when ${shortcut.consumer} is in the game`}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className={styles['footer']}>{RIVAL_RULES_FOOTER}</p>
    </div>
  );
}

export interface RivalRulesChipProps {
  /** The `aip.rules` answer. */
  readonly rules: AipRulesView;
  readonly className?: string | undefined;
}

/**
 * The "Rival rules" chip beside the Promotions heading: how many of the computer's shortcuts are
 * on, or "Level playing field". It opens the full list in a popover on desktop and a bottom sheet
 * on a phone.
 */
export function RivalRulesChip({ rules, className }: RivalRulesChipProps) {
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);
  const text = rivalRulesChipText(rules);
  const chipClass = classNames(styles['chip'], className);

  if (isMobile) {
    return (
      <>
        <Button
          variant="secondary"
          size="sm"
          iconStart="settings"
          className={chipClass}
          aria-haspopup="dialog"
          onClick={() => {
            setSheetOpen(true);
          }}
        >
          {text}
        </Button>
        <Sheet
          open={sheetOpen}
          onClose={() => {
            setSheetOpen(false);
          }}
          title={TITLE}
          side="bottom"
        >
          <RivalRulesList rules={rules} />
        </Sheet>
      </>
    );
  }

  return (
    <Popover
      title={TITLE}
      side="bottom"
      align="start"
      className={classNames(styles['popover'])}
      trigger={
        <Button variant="secondary" size="sm" iconStart="settings" className={chipClass}>
          {text}
        </Button>
      }
    >
      <RivalRulesList rules={rules} />
    </Popover>
  );
}
