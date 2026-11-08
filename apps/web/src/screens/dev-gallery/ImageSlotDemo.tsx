import { useId, useState } from 'react';
import { ImageSlot } from '@/components/ImageSlot';
import type { ImageSlotSize, ImageSubject, PersonStyle } from '@/components/ImageSlot';
import styles from './ImageSlotDemo.module.css';
import { galleryBelts, galleryLogos, galleryPeople, galleryVenues } from './imageSlotFixtures';

const ALL_SIZES: readonly ImageSlotSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];

interface SubjectGridProps {
  readonly title: string;
  readonly subjects: readonly ImageSubject[];
  readonly personStyle: PersonStyle;
}

function SubjectGrid({ title, subjects, personStyle }: SubjectGridProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className={styles['heading']}>
        {title}
      </h3>
      <ul className={styles['grid']}>
        {subjects.map((subject) => (
          <li key={subject.id} className={styles['item']}>
            <ImageSlot subject={subject} size="lg" personStyle={personStyle} decorative />
            <span className={styles['caption']}>
              {subject.name}
              {subject.tier === undefined ? '' : ` (${subject.tier})`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Gallery demo: every placeholder generator, every size, and the silhouette toggle. */
export function ImageSlotDemo() {
  const [personStyle, setPersonStyle] = useState<PersonStyle>('initials');
  const sizesHeadingId = useId();
  const [sizePerson] = galleryPeople;
  const [sizeBelt] = galleryBelts;

  return (
    <div className={styles['demo']}>
      <label className={styles['toggle']}>
        <input
          type="checkbox"
          checked={personStyle === 'silhouette'}
          onChange={(event) => {
            setPersonStyle(event.target.checked ? 'silhouette' : 'initials');
          }}
        />
        Draw people as silhouettes
      </label>

      <section aria-labelledby={sizesHeadingId}>
        <h3 id={sizesHeadingId} className={styles['heading']}>
          Sizes
        </h3>
        <ul className={styles['sizeRow']}>
          {ALL_SIZES.map((size) => (
            <li key={size} className={styles['item']}>
              {sizePerson !== undefined && (
                <ImageSlot subject={sizePerson} size={size} personStyle={personStyle} />
              )}
              {sizeBelt !== undefined && <ImageSlot subject={sizeBelt} size={size} />}
              <span className={styles['caption']}>{size}</span>
            </li>
          ))}
        </ul>
      </section>

      <SubjectGrid title="People" subjects={galleryPeople} personStyle={personStyle} />
      <SubjectGrid title="Belts" subjects={galleryBelts} personStyle={personStyle} />
      <SubjectGrid title="Logo marks" subjects={galleryLogos} personStyle={personStyle} />
      <SubjectGrid title="Venues" subjects={galleryVenues} personStyle={personStyle} />
    </div>
  );
}
