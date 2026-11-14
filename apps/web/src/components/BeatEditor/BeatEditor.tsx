import type { PersonId } from '@ringside/engine';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../Button';
import { VisuallyHidden } from '../layout';
import { defaultMoveAnnouncement, SortableItem, SortableList } from '../SortableList';
import type { SortableMove } from '../SortableList';
import {
  canAddBeat,
  changeBeatKey,
  droppedPeopleMessage,
  limitText,
  moveBeat,
  newBeatDraft,
  nextBeatId,
} from './beatDraft';
import type { BeatDraft, BeatLimit, BeatOption, PersonChip } from './beatDraft';
import { BeatRow, beatNameOf } from './BeatRow';
import type { BeatGroupNumber, BeatHeadingLevel, BeatScore, MoveDirection } from './BeatRow';
import styles from './BeatEditor.module.css';

/** What `renderPicker` gets while a group's "Add person" is open. */
export interface BeatPickerArgs {
  /** 0-based. */
  readonly beatIndex: number;
  readonly group: BeatGroupNumber;
  /** The group's catalog label, such as "Attackers", for the picker's title. */
  readonly groupLabel: string;
  /** Everyone already in this beat, in either group. */
  readonly exclude: readonly PersonId[];
  /** Adds the person to the group and closes the picker. */
  readonly onPick: (person: PersonChip) => void;
  /** Closes the picker without adding anyone. */
  readonly onClose: () => void;
}

export interface BeatEditorProps {
  /** The beats in order. At least one. */
  readonly beats: readonly BeatDraft[];
  readonly onChange: (beats: BeatDraft[]) => void;
  /** The beats the angle type allows, from the catalog. The first is what "Add beat" adds. */
  readonly beatOptions: readonly BeatOption[];
  /** From the engine (`match.previewAngle`'s `beatLimit`); the editor never works it out. */
  readonly limit: BeatLimit;
  /** Draws the person picker (a Sheet) while a group's "Add person" is open. */
  readonly renderPicker: (args: BeatPickerArgs) => ReactNode;
  /** Each beat's score, keyed by the draft's `id`. A row without one shows no score. */
  readonly scores?: Readonly<Record<string, BeatScore>>;
  /** Extra controls after a person's name, such as a manager menu. */
  readonly personExtras?: (person: PersonChip, beatIndex: number) => ReactNode;
  /** Read only: no picking, adding, removing or moving. */
  readonly disabled?: boolean;
  /** The level of each beat's "Beat 1" heading. 3 by default. */
  readonly headingLevel?: BeatHeadingLevel;
  /** Names the list for screen readers. "Beats" by default. */
  readonly label?: string;
}

interface PickerTarget {
  readonly beatId: string;
  readonly group: BeatGroupNumber;
}

interface PendingFocus {
  readonly beatId: string;
  readonly direction: MoveDirection;
}

/**
 * Builds an angle out of beats: an ordered list where each beat has a beat picker limited to
 * `beatOptions`, the people in each of its groups (labelled from the catalog) and an optional score
 * with Why?. Beats move by dragging the grip, from the keyboard on the grip (Space, arrows, Space)
 * or with the Move up / Move down buttons, and every move is announced. At the slot's limit "Add
 * beat" stops and the limit message says why; beats past the limit are marked.
 *
 * Controlled and engine-free: the parent owns the beats and passes the catalog, limit and scores.
 */
export function BeatEditor({
  beats,
  onChange,
  beatOptions,
  limit,
  renderPicker,
  scores,
  personExtras,
  disabled = false,
  headingLevel = 3,
  label = 'Beats',
}: BeatEditorProps) {
  const limitId = useId();
  const listRef = useRef<HTMLOListElement>(null);
  const [picking, setPicking] = useState<PickerTarget | null>(null);
  const [notice, setNotice] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [pendingFocus, setPendingFocus] = useState<PendingFocus | null>(null);

  const optionsByKey = useMemo(
    () => new Map(beatOptions.map((option) => [option.key, option])),
    [beatOptions],
  );
  const nameOf = useCallback(
    (beat: BeatDraft) => beatNameOf(optionsByKey.get(beat.beatKey)),
    [optionsByKey],
  );
  const itemName = useCallback(
    (id: string) => {
      const index = beats.findIndex((beat) => beat.id === id);
      const beat = beats[index];
      return beat === undefined ? id : `Beat ${String(index + 1)}, ${nameOf(beat)}`;
    },
    [beats, nameOf],
  );

  // After Move up / Move down the row is drawn in its new place; keep focus on the button that
  // moved it, or on the other one when the row reached an end.
  useEffect(() => {
    if (pendingFocus === null) return;
    const row = listRef.current?.querySelector(`[data-sortable-id="${pendingFocus.beatId}"]`);
    const other = pendingFocus.direction === 'up' ? 'down' : 'up';
    const same = row?.querySelector<HTMLButtonElement>(`[data-move="${pendingFocus.direction}"]`);
    const fallback = row?.querySelector<HTMLButtonElement>(`[data-move="${other}"]`);
    (same !== null && same !== undefined && !same.disabled ? same : fallback)?.focus();
    setPendingFocus(null);
  }, [pendingFocus]);

  const canAdd = canAddBeat(beats, limit);
  const limitMessage = limitText(beats, limit);

  const replaceBeat = (index: number, beat: BeatDraft): BeatDraft[] =>
    beats.map((current, currentIndex) => (currentIndex === index ? beat : current));

  const move = (from: number, to: number) => {
    const beat = beats[from];
    if (beat === undefined || to < 0 || to >= beats.length || from === to) return;
    const target = beats[to];
    setAnnouncement(
      defaultMoveAnnouncement({
        activeId: beat.id,
        overId: target?.id ?? beat.id,
        fromIndex: from,
        toIndex: to,
        activeName: itemName(beat.id),
        overName: target === undefined ? '' : itemName(target.id),
        total: beats.length,
        mode: 'insert',
      }),
    );
    setNotice('');
    onChange(moveBeat(beats, from, to));
  };

  const handleSortableMove = (sortableMove: SortableMove) => {
    // SortableList announces drags itself.
    setNotice('');
    onChange(moveBeat(beats, sortableMove.fromIndex, sortableMove.toIndex));
  };

  const addBeat = () => {
    const option = beatOptions[0];
    if (!canAdd || option === undefined) return;
    const beat = newBeatDraft(option, nextBeatId(beats));
    setAnnouncement(`Beat ${String(beats.length + 1)}, ${option.name}, added.`);
    setNotice('');
    onChange([...beats, beat]);
  };

  const removeBeat = (index: number) => {
    const beat = beats[index];
    if (beat === undefined || beats.length <= 1) return;
    setAnnouncement(`${itemName(beat.id)}, removed.`);
    setNotice('');
    onChange(beats.filter((_, currentIndex) => currentIndex !== index));
  };

  const changeKey = (index: number, beatKey: string) => {
    const beat = beats[index];
    const option = optionsByKey.get(beatKey);
    if (beat === undefined || option === undefined || beat.beatKey === beatKey) return;
    const changed = changeBeatKey(beat, option);
    setNotice(droppedPeopleMessage(changed.dropped));
    onChange(replaceBeat(index, changed.beat));
  };

  const removePerson = (index: number, group: BeatGroupNumber, person: PersonChip) => {
    const beat = beats[index];
    if (beat === undefined) return;
    const key = group === 1 ? 'groupOne' : 'groupTwo';
    setAnnouncement(`${person.name} removed.`);
    onChange(replaceBeat(index, { ...beat, [key]: beat[key].filter((member) => member.id !== person.id) }));
  };

  const pickerIndex = picking === null ? -1 : beats.findIndex((beat) => beat.id === picking.beatId);
  const pickerBeat = beats[pickerIndex];
  const pickerOption = pickerBeat === undefined ? undefined : optionsByKey.get(pickerBeat.beatKey);
  const pickerGroup =
    picking === null ? undefined : pickerOption?.groups[picking.group === 1 ? 0 : 1];

  const closePicker = () => {
    setPicking(null);
  };

  const picker =
    picking !== null && pickerBeat !== undefined && pickerGroup !== undefined && !disabled
      ? renderPicker({
          beatIndex: pickerIndex,
          group: picking.group,
          groupLabel: pickerGroup.label,
          exclude: [...pickerBeat.groupOne, ...pickerBeat.groupTwo].map((person) => person.id),
          onPick: (person) => {
            const key = picking.group === 1 ? 'groupOne' : 'groupTwo';
            const people = pickerBeat[key];
            setPicking(null);
            if (people.some((member) => member.id === person.id) || people.length >= pickerGroup.maxPeople) {
              return;
            }
            setAnnouncement(`${person.name} added to ${pickerGroup.label}.`);
            onChange(replaceBeat(pickerIndex, { ...pickerBeat, [key]: [...people, person] }));
          },
          onClose: closePicker,
        })
      : null;

  return (
    <div className={styles['editor']}>
      <ol ref={listRef} className={styles['list']} aria-label={label}>
        <SortableList
          ids={beats.map((beat) => beat.id)}
          itemName={itemName}
          onMove={handleSortableMove}
          disabled={disabled}
        >
          {beats.map((beat, index) => (
            <SortableItem key={beat.id} id={beat.id} className={styles['item']}>
              <BeatRow
                beat={beat}
                index={index}
                total={beats.length}
                option={optionsByKey.get(beat.beatKey)}
                beatOptions={beatOptions}
                overLimit={index >= limit.max}
                score={scores?.[beat.id]}
                disabled={disabled}
                canRemove={beats.length > 1}
                headingLevel={headingLevel}
                personExtras={personExtras}
                onChangeKey={(beatKey) => {
                  changeKey(index, beatKey);
                }}
                onAddPerson={(group) => {
                  setPicking({ beatId: beat.id, group });
                }}
                onRemovePerson={(group, person) => {
                  removePerson(index, group, person);
                }}
                onMove={(direction) => {
                  setPendingFocus({ beatId: beat.id, direction });
                  move(index, direction === 'up' ? index - 1 : index + 1);
                }}
                onRemove={() => {
                  removeBeat(index);
                }}
              />
            </SortableItem>
          ))}
        </SortableList>
      </ol>
      <div className={styles['footer']}>
        {!disabled && (
          <Button
            iconStart="add"
            aria-disabled={canAdd ? undefined : true}
            aria-describedby={limitId}
            className={styles['addBeat']}
            onClick={addBeat}
          >
            Add beat
          </Button>
        )}
        <p
          id={limitId}
          role="status"
          className={beats.length > limit.max ? styles['limitOver'] : styles['limit']}
        >
          {limitMessage}
        </p>
      </div>
      <p role="status" className={styles['notice']}>
        {notice}
      </p>
      <VisuallyHidden>
        <span role="status">{announcement}</span>
      </VisuallyHidden>
      {picker}
    </div>
  );
}
