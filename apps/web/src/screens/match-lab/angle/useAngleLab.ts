import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AngleTypeOption,
  BeatOption as EngineBeatOption,
  MatchCatalog,
  PreviewAngleArgs,
  PreviewAngleResult,
  Reason,
} from '@ringside/engine';
import { ANGLES_TUNABLE_CATEGORY, parseContentKey, parseId } from '@ringside/engine';
import { useAnnounce } from '@/app/a11y/LiveAnnouncer';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { useEngineStatus } from '@/app/engine/EngineProvider';
import type { BeatLimit } from '@/components/BeatEditor';
import { WAIT_FOR_DAY_TEXT } from '@/screens/roster/rosterRowActions';
import { freshSeed, useLabStore } from '../labStore';
import {
  angleArgsOf,
  angleBlocker,
  beatOptionsFor,
  limitFromTunables,
  sameAngle,
  visibleAngleTypes,
} from './angleDraft';

/** Stands in for the arguments while no angle Run was asked for; never sent. */
const UNASKED: PreviewAngleArgs = {
  importance: 'regular',
  regionId: parseId('region', 'reg_0000000001'),
  televised: false,
  slotRole: 'midcard',
  angleTypeKey: parseContentKey('angle.promo'),
  beats: [],
  previewSeed: 0,
};

/** A Run that came back with a result, and what it was asked with. */
export interface AngleShown {
  readonly args: PreviewAngleArgs;
  readonly result: PreviewAngleResult;
}

/** Everything Angle mode draws from, worked out once for the lab, the Run bar and the result. */
export interface AngleLabState {
  /** False on a save started before beats existed. */
  readonly hasBeats: boolean;
  readonly angleTypes: readonly AngleTypeOption[];
  readonly angleType: AngleTypeOption | undefined;
  /** The beats the type allows, its default first. */
  readonly beatOptions: readonly EngineBeatOption[];
  readonly limit: BeatLimit;
  /** Why Run can't go yet, or null. */
  readonly blocker: string | null;
  /** True while a Run is on its way. */
  readonly pending: boolean;
  /** The last Run that came back with a result, or null. */
  readonly shown: AngleShown | null;
  /** True when the draft or the show changed since the result on screen. */
  readonly outOfDate: boolean;
  /** The engine's refusal of the last Run, or an empty list. */
  readonly refusals: readonly Reason[];
  /** The engine could not be reached on the last Run. */
  readonly transportError: string | null;
  /** Rates the angle on a fresh seed. */
  readonly run: () => void;
}

/**
 * Angle mode's state (MTCH5-05). Run asks `match.previewAngle` through `useEngineQuery` with the
 * arguments frozen at the press and a fresh seed, so the same seed always gives the same night and
 * every Run can land differently. The limit follows the slot role at once: before a Run it is read
 * from the slot's duration class and the `match.angle.maxBeats.*` tunables, after one from the
 * result while the slot role is still the one it was rated in.
 */
export function useAngleLab(catalog: MatchCatalog): AngleLabState {
  const setup = useLabStore((state) => state.setup);
  const draft = useLabStore((state) => state.angle);
  const angleRun = useLabStore((state) => state.angleRun);
  const runAngle = useLabStore((state) => state.runAngle);
  const advancing = useEngineStatus((state) => state.advancing);
  const announce = useAnnounce();

  const hasBeats = catalog.beats.length > 0;
  const angleTypes = useMemo(() => visibleAngleTypes(catalog), [catalog]);
  const angleType = catalog.angleTypes.find((type) => type.key === draft.angleTypeKey);
  const beatOptions = useMemo(() => beatOptionsFor(catalog, angleType), [catalog, angleType]);

  const slot = useEngineQuery('match.slotInfo', { slotRole: setup.slotRole, kind: 'angle' });
  const tunables = useEngineQuery('tunables.list', { category: ANGLES_TUNABLE_CATEGORY });

  const query = useEngineQuery('match.previewAngle', angleRun?.args ?? UNASKED, {
    enabled: angleRun !== null,
    keepPreviousData: true,
  });
  const [shown, setShown] = useState<AngleShown | null>(null);
  const landed =
    angleRun !== null && query.data !== undefined && !query.isPreviousData
      ? { args: angleRun.args, result: query.data }
      : null;
  if (landed !== null && shown?.result !== landed.result) {
    setShown(landed);
  }
  const shownResult = shown?.result;
  useEffect(() => {
    if (shownResult === undefined) return;
    announce(
      `Angle score ${String(shownResult.score.value)}, delivered ${String(Math.round(shownResult.delivered.value))}`,
    );
  }, [announce, shownResult]);

  const computed = limitFromTunables(slot.data?.durationClass, tunables.data);
  const limit: BeatLimit =
    shown !== null && shown.args.slotRole === setup.slotRole
      ? { max: shown.result.beatLimit.max, message: shown.result.beatLimit.message }
      : computed;

  const blocker = hasBeats
    ? angleBlocker({
        show: setup,
        draft,
        beatOptions,
        limit,
        advancing,
        busyText: WAIT_FOR_DAY_TEXT,
      })
    : 'This save has no beats to build an angle from';

  const pending = angleRun !== null && (query.status === 'loading' || query.isPreviousData);
  const failed = angleRun !== null && query.status === 'error' && !query.isPreviousData;
  const refusals = failed && query.error?.kind === 'rejected' ? query.error.reasons : [];
  const transportError =
    failed && query.error?.kind === 'transport'
      ? 'The game engine did not answer. Try again.'
      : null;

  const current = angleArgsOf(setup, draft, beatOptions, 0);
  const outOfDate = shown !== null && (current === null || !sameAngle(current, shown.args));

  const run = useCallback(() => {
    const args = angleArgsOf(
      useLabStore.getState().setup,
      useLabStore.getState().angle,
      beatOptions,
      freshSeed(1),
    );
    if (args !== null) runAngle(args);
  }, [beatOptions, runAngle]);

  return {
    hasBeats,
    angleTypes,
    angleType,
    beatOptions,
    limit,
    blocker,
    pending,
    shown,
    outOfDate,
    refusals,
    transportError,
    run,
  };
}
