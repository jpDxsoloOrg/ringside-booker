/**
 * The "Choose a venue" sheet the venue panel's Change venue opens (EVT6-06). It lists the venues
 * from `boxOffice.venues` in groups: the show's region, the rest of its country, abroad (behind
 * "Show venues in other countries", which asks with `scope: 'world'`) and the generic local
 * venues, each with its expected crowd and fit. Venues that are closed, exclusive to another
 * promotion or taken that night stay in the list, unavailable, with the reason.
 *
 * Picking a row only selects it, so moving through the list with the arrow keys sends nothing;
 * Use this venue sends `booking.setVenue` and Pick for me `booking.autoVenue`. A refusal is shown
 * in the sheet, which stays open; success closes it and the panel follows the new venue.
 */
import { useState } from 'react';
import type {
  EventInstanceId,
  ShowVenueOptions,
  VenueOption,
  VenueOptionGroup,
  VenueScope,
} from '@ringside/engine';
import { VENUE_OPTION_GROUPS } from '@ringside/engine';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ImageSlot } from '@/components/ImageSlot';
import { RadioGroup } from '@/components/RadioGroup';
import type { RadioOption } from '@/components/RadioGroup';
import { Sheet } from '@/components/Sheet';
import { Switch } from '@/components/Switch';
import { VenueFitBadge } from '@/components/VenueFitBadge';
import styles from './VenueCrowd.module.css';
import {
  choiceKey,
  expectedText,
  groupHeading,
  optionFactsText,
  venueImageSubject,
} from './venueText';

export const ABROAD_SWITCH_LABEL = 'Show venues in other countries';

function OptionLabel({ option }: { readonly option: VenueOption }) {
  return (
    <span className={styles['optionName']}>
      <span>{option.name}</span>
      {option.preferred && <Badge tone="prestige">Preferred</Badge>}
      {option.current && <Badge tone="data">Current</Badge>}
    </span>
  );
}

function OptionDescription({ option }: { readonly option: VenueOption }) {
  return (
    <span className={styles['optionLines']}>
      <span>{optionFactsText(option)}</span>
      <span className={styles['optionCrowd']}>
        <span>{expectedText(option.low, option.high)}</span>
        <VenueFitBadge fit={option.fit} />
      </span>
      {option.disabled !== null && (
        <span className={styles['optionReason']}>Unavailable: {option.disabled.message}</span>
      )}
    </span>
  );
}

function radioOptionOf(option: VenueOption): RadioOption<string> {
  return {
    value: choiceKey(option.choice),
    label: <OptionLabel option={option} />,
    description: <OptionDescription option={option} />,
    preview: <ImageSlot subject={venueImageSubject(option)} size="sm" decorative />,
    unavailable: option.disabled !== null,
  };
}

/** The show's region and country, read from the generic venues (always in the show's region). */
function showPlace(options: ShowVenueOptions): {
  readonly regionName: string;
  readonly countryName: string;
} {
  const local =
    options.options.find((option) => option.group === 'generic') ??
    options.current ??
    options.suggested;
  return {
    regionName: local?.regionName ?? 'this region',
    countryName: local?.countryName ?? 'this country',
  };
}

export interface VenuePickerSheetViewProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** `boxOffice.venues`' answer, or null while it loads. */
  readonly options: ShowVenueOptions | null;
  /** Why the list could not be read, shown in place of it. */
  readonly loadError?: string | null;
  readonly scope: VenueScope;
  readonly onScopeChange: (scope: VenueScope) => void;
  /** The selected row's key (`choiceKey`), or null for none. */
  readonly selected: string | null;
  readonly onSelect: (key: string) => void;
  readonly onUse: () => void;
  readonly onPickForMe: () => void;
  /** Use this venue is running. */
  readonly using?: boolean;
  /** Pick for me is running. */
  readonly picking?: boolean;
  /** Why the game refused the last choice. */
  readonly message?: string | null;
}

/** The sheet from fixed data: no engine access, so the gallery can draw it. */
export function VenuePickerSheetView({
  open,
  onClose,
  options,
  loadError = null,
  scope,
  onScopeChange,
  selected,
  onSelect,
  onUse,
  onPickForMe,
  using = false,
  picking = false,
  message = null,
}: VenuePickerSheetViewProps) {
  const all = options?.options ?? [];
  const chosen = all.find((option) => choiceKey(option.choice) === selected);
  const canUse = chosen?.disabled === null && !chosen.current;
  const busy = using || picking;
  const place = options === null ? null : showPlace(options);

  const groupOf = (group: VenueOptionGroup) => all.filter((option) => option.group === group);
  const groupList = (group: VenueOptionGroup) => {
    const rows = groupOf(group);
    if (rows.length === 0 || place === null) return null;
    return (
      <RadioGroup
        key={group}
        legend={groupHeading(group, place)}
        options={rows.map(radioOptionOf)}
        value={selected ?? ''}
        onValueChange={onSelect}
      />
    );
  };

  const footer = (
    <div className={styles['sheetFooter']}>
      {message !== null && (
        <p className={styles['error']} role="alert">
          {message}
        </p>
      )}
      <div className={styles['actions']}>
        <Button variant="primary" loading={using} disabled={!canUse || busy} onClick={onUse}>
          Use this venue
        </Button>
        <Button loading={picking} disabled={busy} onClick={onPickForMe}>
          Pick for me
        </Button>
      </div>
    </div>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Choose a venue"
      side="right"
      size="md"
      phoneHeight="full"
      footer={footer}
    >
      <div className={styles['picker']}>
        <p className={styles['muted']}>
          Expected crowds are for this card at each venue. Choosing a venue in another region moves
          the show there.
        </p>
        {loadError !== null ? (
          <p className={styles['muted']}>{loadError}</p>
        ) : options === null ? (
          <p className={styles['muted']} role="status">
            Finding venues…
          </p>
        ) : (
          VENUE_OPTION_GROUPS.map((group) =>
            group === 'abroad' ? (
              <div key={group} className={styles['abroad']}>
                <Switch
                  label={ABROAD_SWITCH_LABEL}
                  checked={scope === 'world'}
                  onCheckedChange={(checked) => {
                    onScopeChange(checked ? 'world' : 'country');
                  }}
                />
                {groupList(group)}
              </div>
            ) : (
              groupList(group)
            ),
          )
        )}
      </div>
    </Sheet>
  );
}

export interface VenuePickerSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly eventInstanceId: EventInstanceId;
}

function reasonsText(reasons: readonly { readonly message: string }[]): string {
  return reasons.map((reason) => reason.message).join(' ');
}

/** The sheet as the venue panel opens it: reads the list while open and sends the choice. */
export function VenuePickerSheet({ open, onClose, eventInstanceId }: VenuePickerSheetProps) {
  const [scope, setScope] = useState<VenueScope>('country');
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Only while the sheet is open: the list forecasts every region it shows.
  const query = useEngineQuery('boxOffice.venues', { eventInstanceId, scope }, { enabled: open });
  const setVenue = useEngineCommand('booking.setVenue');
  const autoVenue = useEngineCommand('booking.autoVenue');

  const options = query.data ?? null;
  const current = options?.options.find((option) => option.current);
  const shownSelected = selected ?? (current === undefined ? null : choiceKey(current.choice));
  const loadError =
    query.error === null
      ? null
      : query.error.kind === 'rejected'
        ? reasonsText(query.error.reasons)
        : 'The venues could not be loaded.';

  const close = () => {
    setSelected(null);
    setMessage(null);
    onClose();
  };

  const use = async () => {
    const option = options?.options.find((entry) => choiceKey(entry.choice) === shownSelected);
    if (option === undefined) return;
    setMessage(null);
    const result = await setVenue.run({ eventInstanceId, choice: option.choice });
    if (result.ok) close();
    else setMessage(reasonsText(result.reasons));
  };

  const pickForMe = async () => {
    setMessage(null);
    const result = await autoVenue.run({ eventInstanceId });
    if (result.ok) close();
    else setMessage(reasonsText(result.reasons));
  };

  return (
    <VenuePickerSheetView
      open={open}
      onClose={close}
      options={options}
      loadError={loadError}
      scope={scope}
      onScopeChange={setScope}
      selected={shownSelected}
      onSelect={(key) => {
        setMessage(null);
        setSelected(key);
      }}
      onUse={() => {
        void use();
      }}
      onPickForMe={() => {
        void pickForMe();
      }}
      using={setVenue.pending}
      picking={autoVenue.pending}
      message={message}
    />
  );
}
