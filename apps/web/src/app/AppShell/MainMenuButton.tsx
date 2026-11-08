import { Icon } from '@/components/Icon';
import { classNames } from '@/components/classNames';
import styles from './AppShell.module.css';
import { useExitToMainMenu } from './useExitToMainMenu';

export interface MainMenuButtonProps {
  /** Called once the game has been saved and left, such as closing the More sheet. */
  readonly onLeave?: () => void;
}

/**
 * The "Main menu" item at the foot of the sidebar and the More sheet: saves, unloads the game and
 * returns to the title screen. Disabled while days are advancing; a failed save shows its error
 * here and keeps the player in the game.
 */
export function MainMenuButton({ onLeave }: MainMenuButtonProps) {
  const { exit, saving, blocked, error } = useExitToMainMenu(onLeave);

  return (
    <>
      <button
        type="button"
        className={classNames(styles['navLink'], styles['navButton'])}
        disabled={blocked || saving}
        aria-busy={saving ? true : undefined}
        data-testid="main-menu"
        onClick={() => {
          void exit();
        }}
      >
        <Icon name="log-out" size="md" className={styles['navIcon']} decorative />
        <span className={styles['navLabel']}>{saving ? 'Saving…' : 'Main menu'}</span>
      </button>
      {error !== null && (
        <p className={styles['navError']} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
