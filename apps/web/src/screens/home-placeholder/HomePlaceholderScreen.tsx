import styles from './HomePlaceholderScreen.module.css';

/** Stand-in home screen until the real title screen and app shell arrive. */
export function HomePlaceholderScreen() {
  return (
    <main className={styles['screen']}>
      <h1 className={styles['title']}>Ringside Booker</h1>
      <p className={styles['version']}>Version {__APP_VERSION__}</p>
    </main>
  );
}
