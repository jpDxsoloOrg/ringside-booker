import { IconButton } from '@/components/Button';
import { useSessionStore } from '../session/sessionStore';
import styles from './AppShell.module.css';

/**
 * The one-time notice after a load: the format upgrades that ran on the save ("Upgraded this
 * save: ...") and anything the load worked around, such as tunable overrides this version no
 * longer knows. It stays until dismissed or until the next load.
 */
export function LoadNoticeBanner() {
  const notice = useSessionStore((state) => state.loadNotice);
  const dismiss = useSessionStore((state) => state.dismissLoadNotice);
  if (notice === null) return null;

  return (
    <section
      className={styles['loadNotice']}
      aria-label="About this save"
      data-testid="load-notice"
    >
      <div className={styles['loadNoticeBody']}>
        {notice.upgrades.length > 0 && <p>Upgraded this save: {notice.upgrades.join(', ')}.</p>}
        {notice.warnings.length > 0 && (
          <>
            <p>The save loaded with these changes:</p>
            <ul className={styles['loadNoticeList']}>
              {notice.warnings.map((warning, index) => (
                <li key={`${warning.path}-${String(index)}`}>
                  {warning.path === '' ? warning.message : `${warning.path}: ${warning.message}`}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <IconButton icon="close" label="Dismiss" onClick={dismiss} />
    </section>
  );
}
