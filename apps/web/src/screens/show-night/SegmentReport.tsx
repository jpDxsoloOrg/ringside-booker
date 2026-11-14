import { useId } from 'react';
import type { ReactNode } from 'react';
import type {
  EventInstanceId,
  PersonId,
  SegmentResultView,
  ShowResultsView,
} from '@ringside/engine';
import { classNames } from '@/components/classNames';
import { SegmentResultCard } from '@/components/SegmentResultCard';
import { WorkerLink } from '@/components/WorkerLink';
import type { SegmentReportSectionDefinition } from './segmentReportSections';
import { useSegmentReportSections } from './segmentReportSections';
import styles from './ShowNight.module.css';

function renderPersonLink(personId: PersonId, name: string): ReactNode {
  return <WorkerLink personId={personId} name={name} />;
}

export interface SegmentReportViewProps {
  readonly eventInstanceId: EventInstanceId;
  readonly segment: SegmentResultView;
  readonly view: ShowResultsView;
  /** The sections other features registered, in display order. */
  readonly sections: readonly SegmentReportSectionDefinition[];
  /** Banners inside the result card (MTCH4's "Injured"), once the card is out. */
  readonly banners?: ReactNode;
  /** The card's heading level; each section heads one level below. */
  readonly headingLevel?: 2 | 3;
  /** Fades the report in: only when motion is welcome and the reveal setting is on. */
  readonly animated?: boolean;
}

/**
 * The report after one segment, drawn with no engine query of its own: the result card (result
 * and finish with its Why?, stars and score with the top reasons and the full trace behind
 * Why?, title outcomes), then each section other features registered with
 * `registerSegmentReportSection`, in order. A section whose `render` gives nothing is left out.
 */
export function SegmentReportView({
  eventInstanceId,
  segment,
  view,
  sections,
  banners,
  headingLevel = 2,
  animated = false,
}: SegmentReportViewProps) {
  const SectionHeading = headingLevel === 2 ? 'h3' : 'h4';
  const baseId = useId();
  const parts = sections
    .map((section) => ({ section, content: section.render({ eventInstanceId, segment, view }) }))
    .filter(({ content }) => content !== null && content !== undefined && content !== false);
  return (
    <div
      className={classNames(styles['report'], animated && styles['fadeIn'])}
      data-segment-id={segment.segmentId}
      data-animated={animated ? 'true' : 'false'}
    >
      <SegmentResultCard
        segment={segment}
        headingLevel={headingLevel}
        renderPersonLink={renderPersonLink}
        banners={banners}
      />
      {parts.map(({ section, content }) => {
        const headingId = `${baseId}-${section.id}`;
        return (
          <section
            key={section.id}
            className={styles['reportSection']}
            aria-labelledby={headingId}
            data-section-id={section.id}
          >
            <SectionHeading id={headingId} className={styles['reportSectionHeading']}>
              {section.label}
            </SectionHeading>
            {content}
          </section>
        );
      })}
    </div>
  );
}

export type SegmentReportProps = Omit<SegmentReportViewProps, 'sections'>;

/** {@link SegmentReportView} with the sections registered so far, kept current. */
export function SegmentReport(props: SegmentReportProps) {
  const sections = useSegmentReportSections();
  return <SegmentReportView {...props} sections={sections} />;
}
