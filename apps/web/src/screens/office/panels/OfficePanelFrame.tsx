import { Component, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import styles from './OfficePanelFrame.module.css';

/** What a broken panel says, so the player knows the rest of the Office is still right. */
export const PANEL_ERROR_TITLE = "This panel couldn't load";

/** The error's message, whatever was thrown. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Something went wrong.';
}

/** Logs a broken panel once, naming it, so the cause is in the console for a bug report. */
function logPanelError(panelId: string, error: unknown): void {
  console.error(`The office panel "${panelId}" couldn't load.`, error);
}

export interface OfficePanelErrorProps {
  /** The broken panel's id, shown under "Details". */
  readonly panelId: string;
  readonly error: unknown;
}

/** The frame's error state: a calm note in the panel's place, with the id and message tucked away. */
export function OfficePanelError({ panelId, error }: OfficePanelErrorProps) {
  return (
    <div className={styles['error']} role="note" data-panel-state="error">
      <p className={styles['errorTitle']}>
        <Icon name="warning" size="md" className={styles['errorIcon']} decorative />
        {PANEL_ERROR_TITLE}
      </p>
      <p className={styles['errorBody']}>The rest of the Office is unaffected.</p>
      <details className={styles['details']}>
        <summary className={styles['summary']}>Details</summary>
        <p className={styles['detailText']}>
          Panel <code>{panelId}</code>: {messageOf(error)}
        </p>
      </details>
    </div>
  );
}

interface BoundaryProps {
  readonly panelId: string;
  readonly children: ReactNode;
}

interface BoundaryState {
  /** What the panel threw, wrapped so a thrown `undefined` still counts. */
  readonly failure: { readonly error: unknown } | null;
}

/**
 * React only catches render errors in a class component, so this is the one class: it swaps a
 * panel that throws for {@link OfficePanelError} and logs it once.
 */
class PanelBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failure: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { failure: { error } };
  }

  override componentDidCatch(error: unknown): void {
    logPanelError(this.props.panelId, error);
  }

  override render(): ReactNode {
    const { failure } = this.state;
    if (failure !== null) {
      return <OfficePanelError panelId={this.props.panelId} error={failure.error} />;
    }
    return this.props.children;
  }
}

/** A panel whose `render` threw before drawing anything: logged once, then shown as broken. */
function ThrownPanel({ panelId, error }: OfficePanelErrorProps) {
  useEffect(() => {
    logPanelError(panelId, error);
  }, [panelId, error]);
  return <OfficePanelError panelId={panelId} error={error} />;
}

export interface OfficePanelFrameProps {
  /** The panel's registered id. */
  readonly panelId: string;
  /** Draws the panel's content. Called inside the frame, so a throw here is caught too. */
  readonly render: () => ReactNode;
}

/**
 * One Office panel, safe to break: anything it throws, while working out its content or while
 * drawing it, shows "This panel couldn't load" in its place and the rest of the Office keeps
 * working. A panel that has nothing to show (its render returns null) is left out entirely.
 */
export function OfficePanelFrame({ panelId, render }: OfficePanelFrameProps) {
  let content: ReactNode;
  try {
    content = render();
  } catch (error: unknown) {
    return (
      <div className={styles['frame']} data-office-panel={panelId}>
        <ThrownPanel panelId={panelId} error={error} />
      </div>
    );
  }
  if (content === null || content === undefined || content === false) return null;
  return (
    <div className={styles['frame']} data-office-panel={panelId}>
      <PanelBoundary panelId={panelId}>{content}</PanelBoundary>
    </div>
  );
}
