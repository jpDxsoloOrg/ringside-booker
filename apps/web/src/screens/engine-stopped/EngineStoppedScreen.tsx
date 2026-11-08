import { useEffect, useRef, useState } from 'react';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import type { EngineFatal } from '@/app/engine/engineStatusStore';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import styles from './EngineStoppedScreen.module.css';

const PAGE_TITLE = 'The simulation stopped';

type CopyState = 'idle' | 'copied' | 'failed';

export interface EngineStoppedScreenProps {
  readonly fatal: EngineFatal;
}

/** The text "Copy error details" puts on the clipboard, for a bug report. */
export function errorReport(fatal: EngineFatal): string {
  const lines = [
    `Ringside Booker ${__APP_VERSION__}: the simulation stopped`,
    `Error: ${fatal.message}`,
  ];
  if (fatal.stack !== null && fatal.stack !== '') lines.push('', fatal.stack);
  return lines.join('\n');
}

/**
 * Shown in place of every route when the engine worker dies, so the app never sits frozen waiting
 * for an answer that will not come. It renders outside the router, so it uses no routing.
 */
export function EngineStoppedScreen({ fatal }: EngineStoppedScreenProps) {
  useDocumentTitle(PAGE_TITLE);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [copyState, setCopyState] = useState<CopyState>('idle');

  // The screen replaces whatever had focus, so focus moves to its heading.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const copyDetails = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(errorReport(fatal));
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <main className={styles['screen']}>
      <div className={styles['card']}>
        <Icon name="warning" size="lg" className={styles['icon']} decorative />
        <h1 ref={headingRef} tabIndex={-1} className={styles['heading']}>
          {PAGE_TITLE}
        </h1>
        <p className={styles['body']}>
          Something inside the game went wrong and it can&apos;t carry on. Your last autosave is
          intact: reload to pick up from there.
        </p>
        <details className={styles['details']}>
          <summary className={styles['summary']}>Error details</summary>
          <pre className={styles['errorText']}>{errorReport(fatal)}</pre>
        </details>
        <div className={styles['actions']}>
          <Button
            variant="primary"
            iconStart="history"
            className={styles['action']}
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </Button>
          <Button
            iconStart="clipboard"
            className={styles['action']}
            onClick={() => {
              void copyDetails();
            }}
          >
            Copy error details
          </Button>
        </div>
        <p className={styles['copyStatus']} role="status">
          {copyState === 'copied' && 'Copied. Paste it into your bug report.'}
          {copyState === 'failed' &&
            'Could not reach the clipboard. Open Error details and copy the text from there.'}
        </p>
      </div>
    </main>
  );
}
