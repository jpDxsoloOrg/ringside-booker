import { useState } from 'react';
import { parseId } from '@ringside/engine';
import type { TraceNode } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { BeatEditor } from '@/components/BeatEditor';
import type {
  BeatDraft,
  BeatLimit,
  BeatOption,
  BeatPickerArgs,
  BeatScore,
  PersonChip,
} from '@/components/BeatEditor';
import { Button } from '@/components/Button';
import { Stack } from '@/components/layout';
import { Sheet } from '@/components/Sheet';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

function person(index: number, name: string): PersonChip {
  return { id: parseId('person', `per_${String(index + 501).padStart(10, '0')}`), name };
}

const REX = person(0, 'Rex Halden');
const TOBIN = person(1, 'Tobin Vasquell');
const MILA = person(2, 'Mila Stroud');
const DARIUS = person(3, 'Darius "The Lighthouse Keeper" Montgomery-Okonkwo');
const JUNO = person(4, 'Juno Park');
const PEOPLE: readonly PersonChip[] = [REX, TOBIN, MILA, DARIUS, JUNO];

/** A slice of the base catalog: the beats a feud angle allows. */
const BEAT_OPTIONS: readonly BeatOption[] = [
  {
    key: 'beat.staredown',
    name: 'Staredown',
    description: 'Rivals stand face to face and say nothing. The crowd fills the silence.',
    groups: [
      { label: 'Side A', minPeople: 1, maxPeople: 4, optional: false },
      { label: 'Side B', minPeople: 1, maxPeople: 4, optional: false },
    ],
    physical: false,
  },
  {
    key: 'beat.war-of-words',
    name: 'War of Words',
    description: 'Two sides trade insults on the microphone, each trying to have the last word.',
    groups: [
      { label: 'Side A', minPeople: 1, maxPeople: 4, optional: false },
      { label: 'Side B', minPeople: 1, maxPeople: 4, optional: false },
    ],
    physical: false,
  },
  {
    key: 'beat.brawl',
    name: 'Brawl',
    description:
      'Everyone involved throws punches until the ring, the floor or backstage is a mess.',
    groups: [{ label: 'Brawlers', minPeople: 2, maxPeople: 6, optional: false }],
    physical: true,
  },
  {
    key: 'beat.attack',
    name: 'Attack',
    description: 'One side jumps the other without warning.',
    groups: [
      { label: 'Attackers', minPeople: 1, maxPeople: 4, optional: false },
      { label: 'Targets', minPeople: 1, maxPeople: 4, optional: false },
    ],
    physical: true,
  },
  {
    key: 'beat.promo',
    name: 'Promo',
    description: 'One side takes the microphone and talks to the crowd, a rival or the camera.',
    groups: [{ label: 'Speaker', minPeople: 1, maxPeople: 4, optional: false }],
    physical: false,
  },
  {
    key: 'beat.interview',
    name: 'Interview',
    description: 'Someone answers questions from an interviewer, backstage or at ringside.',
    groups: [
      { label: 'Guest', minPeople: 1, maxPeople: 3, optional: false },
      { label: 'Host', minPeople: 1, maxPeople: 1, optional: true },
    ],
    physical: false,
  },
];

const SHORT: BeatLimit = { max: 2, message: 'Short slot: up to 2 beats' };
const STANDARD: BeatLimit = { max: 4, message: 'Standard slot: up to 4 beats' };
const LONG: BeatLimit = { max: 6, message: 'Long slot: up to 6 beats' };

function beatTrace(name: string, value: number, groups: readonly [string, number][]): TraceNode {
  return {
    kind: 'formula',
    label: `Beat: ${name}`,
    value,
    docRef: 'angle-rating.md#beat-score',
    children: [
      ...groups.map(([label, groupValue]): TraceNode => ({
        kind: 'input',
        label,
        value: groupValue,
      })),
      {
        kind: 'add',
        label: 'How the beat landed',
        value,
        operand: 2,
        before: value - 2,
        after: value,
      },
    ],
  };
}

function score(name: string, value: number, groups: readonly [string, number][]): BeatScore {
  return { value, trace: beatTrace(name, value, groups) };
}

const FEUD: readonly BeatDraft[] = [
  { id: 'feud-1', beatKey: 'beat.staredown', groupOne: [REX], groupTwo: [TOBIN] },
  { id: 'feud-2', beatKey: 'beat.war-of-words', groupOne: [REX, MILA], groupTwo: [TOBIN] },
  { id: 'feud-3', beatKey: 'beat.brawl', groupOne: [REX, TOBIN, DARIUS], groupTwo: [] },
];

const FEUD_SCORES: Readonly<Record<string, BeatScore>> = {
  'feud-1': score('Staredown', 58, [
    ['Side A', 61],
    ['Side B', 55],
  ]),
  'feud-2': score('War of Words', 71.4, [
    ['Side A', 76],
    ['Side B', 64],
  ]),
  'feud-3': score('Brawl', 66, [['Brawlers', 66]]),
};

/** The gallery's stand-in for the lab's worker picker: a sheet of a few people. */
function DemoPicker({ groupLabel, exclude, onPick, onClose }: BeatPickerArgs) {
  return (
    <Sheet open onClose={onClose} title={`Add to ${groupLabel}`} size="sm">
      <Stack gap={2}>
        {PEOPLE.filter((candidate) => !exclude.includes(candidate.id)).map((candidate) => (
          <Button
            key={candidate.id}
            variant="ghost"
            onClick={() => {
              onPick(candidate);
            }}
          >
            {candidate.name}
          </Button>
        ))}
      </Stack>
    </Sheet>
  );
}

function renderDemoPicker(args: BeatPickerArgs) {
  return <DemoPicker {...args} />;
}

interface DemoProps {
  readonly title: string;
  readonly initial: readonly BeatDraft[];
  readonly limit: BeatLimit;
  readonly scores?: Readonly<Record<string, BeatScore>>;
  readonly withManager?: boolean;
  readonly disabled?: boolean;
}

function Demo({ title, initial, limit, scores, withManager = false, disabled = false }: DemoProps) {
  const [beats, setBeats] = useState(initial);
  return (
    <section>
      <h3 className={styles['subheading']}>{title}</h3>
      <BeatEditor
        label={`Beats: ${title}`}
        beats={beats}
        onChange={setBeats}
        beatOptions={BEAT_OPTIONS}
        limit={limit}
        renderPicker={renderDemoPicker}
        headingLevel={4}
        disabled={disabled}
        {...(scores === undefined ? {} : { scores })}
        {...(withManager
          ? {
              personExtras: (chip: PersonChip) =>
                chip.id === MILA.id ? <Badge tone="data">Talks via manager</Badge> : null,
            }
          : {})}
      />
    </section>
  );
}

function BeatEditorDemo() {
  return (
    <Stack gap={6}>
      <Demo
        title="One default beat"
        initial={[{ id: 'one-1', beatKey: 'beat.promo', groupOne: [], groupTwo: [] }]}
        limit={STANDARD}
      />
      <Demo
        title="Staredown, war of words and brawl, with scores"
        initial={FEUD}
        limit={LONG}
        scores={FEUD_SCORES}
        withManager
      />
      <Demo title="At the limit" initial={FEUD.slice(0, 2)} limit={SHORT} />
      <Demo title="Over the limit" initial={FEUD} limit={SHORT} />
      <Demo title="Read only" initial={FEUD} limit={LONG} scores={FEUD_SCORES} disabled />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'beat-editor',
  title: 'BeatEditor',
  group: 'Office',
  notes:
    'Build an angle from beats. Drag a grip, or focus it and press Space, the arrows and Space; Move up and Move down sit on each row (always shown on a phone). The limit comes from the engine.',
  render: () => <BeatEditorDemo />,
};
