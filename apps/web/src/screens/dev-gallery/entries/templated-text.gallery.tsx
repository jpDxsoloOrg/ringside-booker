import { parseContentKey } from '@ringside/engine';
import { Stack } from '@/components/layout';
import { registerTextCatalog } from '@/text/catalog';
import type { TextCatalog } from '@/text/catalog';
import { renderTemplatedText, templatedTextToString } from '@/text/renderTemplatedText';
import type { TemplatedText, TextNames } from '@/text/renderTemplatedText';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

const GALLERY_TEXT: TextCatalog = {
  'gallerytext.names': '{who} signed with {promotion}',
  'gallerytext.formats':
    'On {day:date}, {crowd:count} fans saw the {reign:ordinal} reign begin, for a purse of {purse:money}.',
};

registerTextCatalog('gallerytext', GALLERY_TEXT);

const NAMES: TextNames = {
  per_0000000901: { kind: 'person', name: 'Mara Lindqvist' },
  per_0000000902: { kind: 'person', name: 'Tobias Reyne' },
  per_0000000903: { kind: 'person', name: 'Ines Okafor' },
  pro_0000000901: { kind: 'promotion', name: 'Harbourline Pro' },
};

function text(key: string, params: TemplatedText['params']): TemplatedText {
  return { key: parseContentKey(key), params };
}

const SAMPLES: readonly { readonly label: string; readonly text: TemplatedText }[] = [
  {
    label: 'One name',
    text: text('gallerytext.names', { who: 'per_0000000901', promotion: 'pro_0000000901' }),
  },
  {
    label: 'Two names',
    text: text('gallerytext.names', {
      who: 'per_0000000901,per_0000000902',
      promotion: 'pro_0000000901',
    }),
  },
  {
    label: 'Three names',
    text: text('gallerytext.names', {
      who: 'per_0000000901,per_0000000902,per_0000000903',
      promotion: 'pro_0000000901',
    }),
  },
  {
    label: 'An id that is gone',
    text: text('gallerytext.names', { who: 'per_0000000999', promotion: 'pro_0000000901' }),
  },
  {
    label: 'Each format: date, count, ordinal, money',
    text: text('gallerytext.formats', {
      day: '2027-05-01',
      crowd: 12500,
      reign: 3,
      purse: 2_500_000,
    }),
  },
  { label: 'A key with no words', text: text('gallerytext.not-written', {}) },
];

function TemplatedTextDemo() {
  return (
    <Stack gap={4}>
      {SAMPLES.map((sample) => (
        <section key={sample.label} className={styles['example']}>
          <h3 className={styles['subheading']}>{sample.label}</h3>
          <p>{renderTemplatedText(sample.text, { names: NAMES })}</p>
          <p className={styles['caption']}>
            As a string: {templatedTextToString(sample.text, { names: NAMES })}
          </p>
        </section>
      ))}
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'templated-text',
  title: 'Templated text',
  group: 'Data',
  notes:
    'The shared renderer for engine text (text/README.md). Names link inside the game; here they are plain text.',
  render: () => <TemplatedTextDemo />,
};
