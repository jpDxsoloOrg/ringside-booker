import { useId } from 'react';
import type { BookingIssue, BookingValidation, ChecklistItem, TraceNode } from '@ringside/engine';
import { Icon } from '@/components/Icon';
import { WhyButton } from '@/components/Trace';
import styles from './Booking.module.css';

export interface ValidationChecklistProps {
  /** `booking.validate`'s answer, or null while it loads. */
  readonly validation: BookingValidation | null;
  /** Scrolls to a slot's row and focuses it. Issues about a slot are buttons that call it. */
  readonly onShowSlot?: (preShow: boolean, slot: number) => void;
  /** Level of the panel's heading. 2 by default. */
  readonly headingLevel?: 2 | 3;
}

/** "Slot 3", "Pre-show slot 1", or "Card" for a problem with the whole card. */
export function issuePlace(issue: BookingIssue): string {
  if (issue.slot === undefined) return 'Card';
  const number = String(issue.slot.slot + 1);
  return issue.slot.preShow ? `Pre-show slot ${number}` : `Slot ${number}`;
}

/** The number a trace works out, for the Why? button's name. */
function traceResult(trace: TraceNode): string | number | boolean | null {
  return 'value' in trace ? trace.value : null;
}

function LineIcon({ item }: { readonly item: ChecklistItem }) {
  if (item.passed) return <Icon name="check" label="Passed" />;
  return item.severity === 'error' ? (
    <Icon name="error" label="Problem" />
  ) : (
    <Icon name="warning" label="Warning" />
  );
}

function ChecklistLine({ item }: { readonly item: ChecklistItem }) {
  const state = item.passed ? 'passed' : item.severity;
  return (
    <li className={styles['checkLine']} data-state={state}>
      <span className={styles['checkIcon']}>
        <LineIcon item={item} />
      </span>
      <span className={styles['checkText']}>
        <span className={styles['checkLabel']}>
          {item.label}
          {item.trace !== undefined && (
            <WhyButton
              label="the slots that must be filled"
              value={traceResult(item.trace)}
              panelTitle="Main card slots that must be filled"
              source={{ trace: item.trace }}
            />
          )}
        </span>
        {item.detail !== undefined && <span className={styles['checkDetail']}>{item.detail}</span>}
      </span>
    </li>
  );
}

interface IssueListProps {
  readonly issues: readonly BookingIssue[];
  readonly title: string;
  readonly severity: 'error' | 'warning';
  readonly onShowSlot: ((preShow: boolean, slot: number) => void) | undefined;
  readonly headingLevel: 3 | 4;
}

function IssueList({ issues, title, severity, onShowSlot, headingLevel }: IssueListProps) {
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const headingId = useId();
  if (issues.length === 0) return null;
  return (
    <div className={styles['issueGroup']} data-severity={severity}>
      <Heading id={headingId} className={styles['issueHeading']}>
        <Icon name={severity === 'error' ? 'error' : 'warning'} decorative />
        {title}
      </Heading>
      <ul aria-labelledby={headingId} className={styles['issueList']}>
        {issues.map((issue, index) => {
          const key = `${issue.checkId}-${issue.code}-${String(index)}`;
          const place = <span className={styles['issuePlace']}>{issuePlace(issue)}</span>;
          const { slot } = issue;
          return (
            <li key={key} className={styles['issue']}>
              {slot !== undefined && onShowSlot !== undefined ? (
                <button
                  type="button"
                  className={styles['issueButton']}
                  onClick={() => {
                    onShowSlot(slot.preShow, slot.slot);
                  }}
                >
                  {place}
                  <span>{issue.message}</span>
                </button>
              ) : (
                <span className={styles['issueText']}>
                  {place}
                  <span>{issue.message}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * What stands between a card and Run the show: the checklist lines from `booking.validate`, each passed,
 * failed (a problem, red) or questioned (a warning, amber), always with an icon and words, then
 * every problem and warning with the slot it is about. A problem about a slot takes you to it.
 */
export function ValidationChecklist({
  validation,
  onShowSlot,
  headingLevel = 2,
}: ValidationChecklistProps) {
  const headingId = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section aria-labelledby={headingId} className={styles['checklist']}>
      <Heading id={headingId} className={styles['sideHeading']}>
        Checklist
      </Heading>
      {validation === null ? (
        <p className={styles['muted']} role="status">
          Checking the card…
        </p>
      ) : (
        <>
          <ul className={styles['checkLines']}>
            {validation.checklist.map((item) => (
              <ChecklistLine key={item.id} item={item} />
            ))}
          </ul>
          <IssueList
            issues={validation.errors}
            title={
              validation.errors.length === 1
                ? '1 problem'
                : `${String(validation.errors.length)} problems`
            }
            severity="error"
            onShowSlot={onShowSlot}
            headingLevel={headingLevel === 2 ? 3 : 4}
          />
          <IssueList
            issues={validation.warnings}
            title={
              validation.warnings.length === 1
                ? '1 warning'
                : `${String(validation.warnings.length)} warnings`
            }
            severity="warning"
            onShowSlot={onShowSlot}
            headingLevel={headingLevel === 2 ? 3 : 4}
          />
        </>
      )}
    </section>
  );
}
