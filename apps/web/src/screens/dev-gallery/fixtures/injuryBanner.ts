/**
 * Hand-made injuries for the InjuryBanner gallery entry (MTCH4-06): a short and a long layoff, a
 * very long name, and one whose Why?s are no longer kept. The stand-in engine answers the two Why?
 * panels with small traces built by the engine's own trace builders, worded like the real ones.
 */
import type { StoredTrace, TraceRef } from '@ringside/engine';
import { parseGameDate, startCalc } from '@ringside/engine';
import type { InjuryBannerProps } from '@/components/InjuryBanner';

const STORED_DATE = parseGameDate('2031-03-14');

function chanceRef(serial: number): TraceRef {
  return {
    kind: 'match.injuryChance',
    id: `seg_gallery${String(serial)}:per_gallery${String(serial)}`,
  };
}

function injuryRef(serial: number): TraceRef {
  return { kind: 'health.injury', id: `inj_gallery${String(serial)}` };
}

function chanceTrace(name: string, value: number) {
  return startCalc(`Injury chance for ${name}`, 0.003, {
    unit: 'probability',
    startLabel: 'Base injury chance',
  })
    .add('Fatigue by the end of the match', value / 3)
    .add('Worst body part: Legs 41', value / 3)
    .multiply('Long duration class', 1.3)
    .multiply('Least safe opponent: Test Opponent, safety 28', 1.2)
    .done();
}

function daysTrace(kind: string, days: number) {
  return startCalc('Days out', days * 0.8, {
    unit: 'days',
    startLabel: `${kind}: the usual time out`,
  })
    .multiply('Moderate injury', 1.25, 'How bad it is')
    .done();
}

export interface GalleryInjury {
  readonly title: string;
  readonly props: InjuryBannerProps;
}

/** The examples, in the gallery's order. */
export const GALLERY_INJURIES: readonly GalleryInjury[] = [
  {
    title: 'A short layoff',
    props: {
      name: 'Vance Troy',
      bodyPart: 'arms',
      kindLabel: 'Bruised elbow',
      weeksOut: 1,
      chance: 0.031,
      chanceTraceRef: chanceRef(1),
      injuryTraceRef: injuryRef(1),
    },
  },
  {
    title: 'A long layoff',
    props: {
      name: 'Rex Ironside',
      bodyPart: 'legs',
      kindLabel: 'Torn knee ligament',
      weeksOut: 26,
      chance: 0.064,
      chanceTraceRef: chanceRef(2),
      injuryTraceRef: injuryRef(2),
    },
  },
  {
    title: 'A very long name',
    props: {
      name: 'Bartholomew "The Unbreakable" Featherstonehaugh-Wolfenden',
      bodyPart: 'neck',
      kindLabel: 'Stinger',
      weeksOut: 3,
      chance: 0.012,
      chanceTraceRef: chanceRef(3),
      injuryTraceRef: injuryRef(3),
    },
  },
  {
    title: 'An older show: the Why?s are no longer kept',
    props: {
      name: 'Mara Quill',
      bodyPart: 'back',
      kindLabel: 'Back spasms',
      weeksOut: 2,
      chance: null,
      chanceTraceRef: null,
      injuryTraceRef: null,
    },
  },
];

/** The traces behind the examples' Why?s. */
export function injuryBannerTraces(): StoredTrace[] {
  const traces: StoredTrace[] = [];
  GALLERY_INJURIES.forEach(({ props }, index) => {
    if (props.chanceTraceRef !== null && props.chance !== null) {
      const chance = chanceTrace(props.name, props.chance);
      traces.push({
        ref: props.chanceTraceRef,
        date: STORED_DATE,
        seq: index * 2 + 1,
        trace: chance.trace,
        value: chance.value,
      });
    }
    if (props.injuryTraceRef !== null) {
      const days = daysTrace(props.kindLabel, props.weeksOut * 7);
      traces.push({
        ref: props.injuryTraceRef,
        date: STORED_DATE,
        seq: index * 2 + 2,
        trace: days.trace,
        value: days.value,
      });
    }
  });
  return traces;
}
