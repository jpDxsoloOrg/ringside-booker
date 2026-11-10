import { PUSH_LABELS, STYLE_LABELS, WEIGHT_CLASS_LABELS } from '@ringside/engine';
import type { WorkerProfileHeader as WorkerProfileHeaderData } from '@ringside/engine';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { AlignmentChip } from '@/components/AlignmentChip';
import { AvailabilityChip } from '@/components/AvailabilityChip';
import { formatNumber } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import type { ImageSubject } from '@/components/ImageSlot';
import { ExplainedText } from './ExplainedText';
import styles from './WorkerProfile.module.css';

export interface WorkerProfileHeaderProps {
  readonly header: WorkerProfileHeaderData;
}

/** "183 cm · 104 kg": height and weight as the header writes them. */
export function sizeText(heightCm: number, weightKg: number): string {
  return `${formatNumber(heightCm)} cm · ${formatNumber(weightKg)} kg`;
}

/**
 * The top of a worker's profile: picture, ring name (the page heading), legal name when it is a
 * different one, then age, size with the weight class, style, employer, push, alignment and
 * whether they can work today.
 */
export function WorkerProfileHeader({ header }: WorkerProfileHeaderProps) {
  const subject: ImageSubject = {
    kind: 'person',
    id: header.personId,
    name: header.ringName,
    ...(header.imageRef === null ? {} : { imageRef: header.imageRef }),
  };
  const showLegalName = header.legalName !== header.ringName;

  return (
    <header className={styles['header']}>
      <ImageSlot subject={subject} size="lg" decorative />
      <div className={styles['identity']}>
        <RouteHeading className={styles['heading']}>{header.ringName}</RouteHeading>
        {showLegalName && (
          <p className={styles['legalName']}>
            <span className={styles['factLabel']}>Real name</span> {header.legalName}
          </p>
        )}
        <div className={styles['chips']}>
          {header.alignment !== null && (
            <AlignmentChip alignment={header.alignment} variant="solid" />
          )}
          <AvailabilityChip availability={header.availability} />
        </div>
      </div>
      <dl className={styles['facts']}>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Age</dt>
          <dd className="tabular">{formatNumber(header.age)}</dd>
        </div>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Size</dt>
          <dd className="tabular">{sizeText(header.heightCm, header.weightKg)}</dd>
        </div>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Weight class</dt>
          <dd>
            <ExplainedText
              label="Weight class"
              text={WEIGHT_CLASS_LABELS[header.weightClass.value]}
              trace={header.weightClass.trace}
            />
          </dd>
        </div>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Style</dt>
          <dd>{STYLE_LABELS[header.style]}</dd>
        </div>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Employer</dt>
          <dd>{header.employer === null ? 'Free agent' : header.employer.name}</dd>
        </div>
        {header.push !== null && (
          <div className={styles['fact']}>
            <dt className={styles['factLabel']}>Push</dt>
            <dd>{PUSH_LABELS[header.push]}</dd>
          </div>
        )}
      </dl>
    </header>
  );
}
