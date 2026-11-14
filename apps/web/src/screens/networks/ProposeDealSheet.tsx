import { useState } from 'react';
import { isId, parseId } from '@ringside/engine';
import type {
  DealId,
  DealTimeslot,
  EventDefinitionId,
  NetworkId,
  NetworkRow,
  PromotionId,
  PromotionProfileShow,
  Reason,
} from '@ringside/engine';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Button } from '@/components/Button';
import { RadioGroup } from '@/components/RadioGroup';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { Sheet } from '@/components/Sheet';
import { Switch } from '@/components/Switch';
import { ProposalPreview } from './ProposalPreview';
import {
  DEAL_LENGTH_MONTHS,
  monthsText,
  NETWORK_KIND_LABELS,
  TIMESLOT_LABELS,
  TIMESLOTS,
} from './networkText';
import { useDefaultDealMonths } from './useDefaultDealMonths';
import styles from './Networks.module.css';

/** The show picker's value for a promotion-wide deal. */
export const ALL_SHOWS_VALUE = 'all';
export const NO_TIMESLOT_TEXT = "Pay-per-view isn't tied to a timeslot.";

/** Stands in for the network while the sheet is closed; the query is held back then. */
const NO_NETWORK = parseId('network', 'net_0000000000');

const PPV_IMPORTANCES: readonly string[] = ['major', 'flagship'];

/**
 * The shows a network can be offered: the promotion's own shows except house shows (major and
 * flagship only on pay-per-view, plus "All major shows"). A show that is not televised yet says it
 * becomes one.
 */
export function showOptions(
  kind: NetworkRow['kind'],
  shows: readonly PromotionProfileShow[],
): readonly SelectOption[] {
  const eligible = shows.filter(
    (show) =>
      show.importance !== 'house' && (kind !== 'ppv' || PPV_IMPORTANCES.includes(show.importance)),
  );
  const options: SelectOption[] = eligible.map((show) => ({
    value: show.eventDefinitionId,
    label: show.televised ? show.name : `${show.name} (becomes a TV show)`,
  }));
  if (kind === 'ppv') options.unshift({ value: ALL_SHOWS_VALUE, label: 'All major shows' });
  return options;
}

function showIdOf(value: string): EventDefinitionId | null {
  return isId('eventDefinition', value) ? value : null;
}

export interface ProposeDealSheetProps {
  readonly promotionId: PromotionId;
  /** The network being proposed to (`?propose=`), or null when the sheet is closed. */
  readonly networkId: NetworkId | null;
  readonly onClose: () => void;
  /** The network signed. The caller switches to Your deals and announces it. */
  readonly onSigned: (dealId: DealId, networkName: string) => void;
}

interface Choice {
  readonly show: string | null;
  readonly timeslot: DealTimeslot | null;
  readonly live: boolean;
  readonly months: number | null;
}

const NO_CHOICE: Choice = { show: null, timeslot: null, live: false, months: null };

/**
 * Propose a deal: pick the show, the timeslot (not on pay-per-view), live or taped and the length,
 * and see what the network would do, re-asked on every change, before **Propose deal**. It stays
 * disabled while the network would refuse; a refusal from the engine shows its reasons.
 */
export function ProposeDealSheet({
  promotionId,
  networkId,
  onClose,
  onSigned,
}: ProposeDealSheetProps) {
  const [shownId, setShownId] = useState<NetworkId | null>(networkId);
  if (networkId !== null && networkId !== shownId) setShownId(networkId);
  const [choice, setChoice] = useState<Choice>(NO_CHOICE);
  const [refusals, setRefusals] = useState<readonly Reason[]>([]);
  const defaultMonths = useDefaultDealMonths();
  const open = networkId !== null;
  const networks = useEngineQuery('broadcast.networks', { promotionId }, { enabled: open });
  const profile = useEngineQuery('promotions.profile', { promotionId }, { enabled: open });
  const propose = useEngineCommand('broadcast.proposeDeal');

  const network = networks.data?.find((row) => row.networkId === shownId) ?? null;
  const options =
    network === null || profile.data === undefined
      ? []
      : showOptions(network.kind, profile.data.shows);
  const bestShow =
    network?.bestOffer === null || network?.bestOffer === undefined
      ? null
      : (network.bestOffer.eventDefinitionId ?? ALL_SHOWS_VALUE);
  const show =
    choice.show ??
    options.find((option) => option.value === bestShow)?.value ??
    options[0]?.value ??
    null;
  const timeslot: DealTimeslot =
    network?.kind === 'ppv'
      ? 'primeTime'
      : (choice.timeslot ?? network?.bestOffer?.timeslot ?? 'evening');
  const months = choice.months ?? defaultMonths;

  const args =
    network === null || show === null
      ? null
      : {
          promotionId,
          networkId: network.networkId,
          eventDefinitionId: showIdOf(show),
          timeslot,
          live: choice.live,
          months,
        };
  const preview = useEngineQuery(
    'broadcast.valuation',
    args ?? {
      promotionId,
      networkId: shownId ?? network?.networkId ?? NO_NETWORK,
      eventDefinitionId: null,
      timeslot: 'evening',
      live: false,
      months,
    },
    { enabled: open && args !== null, keepPreviousData: true },
  );
  const valuation = args === null ? undefined : preview.data;

  const change = (next: Partial<Choice>): void => {
    setChoice((current) => ({ ...current, ...next }));
    setRefusals([]);
  };

  const close = (): void => {
    setChoice(NO_CHOICE);
    setRefusals([]);
    onClose();
  };

  const submit = async (): Promise<void> => {
    if (args === null || network === null) return;
    const result = await propose.run(args);
    if (!result.ok) {
      setRefusals(result.reasons);
      return;
    }
    setChoice(NO_CHOICE);
    setRefusals([]);
    onSigned(result.data.dealId, network.name);
  };

  const refused = valuation === undefined || valuation.verdict === 'refuse' || preview.isStale;

  let body;
  if (networks.status === 'error' || profile.status === 'error') {
    body = <p>This network can't be asked right now.</p>;
  } else if (network === null || profile.data === undefined) {
    body = <p className={styles['muted']}>Loading…</p>;
  } else if (options.length === 0) {
    body = (
      <p>
        You have no show {network.name} would carry.{' '}
        {network.kind === 'ppv'
          ? 'Pay-per-view only carries major and flagship shows.'
          : 'House shows are never televised.'}
      </p>
    );
  } else {
    body = (
      <div className={styles['sheetBody']}>
        <p className={styles['muted']}>{NETWORK_KIND_LABELS[network.kind]}</p>
        <div className={styles['proposeForm']}>
          <Select
            label="Show"
            options={options}
            value={show ?? ''}
            onValueChange={(value) => {
              change({ show: value });
            }}
          />
          <Select
            label="Length"
            options={DEAL_LENGTH_MONTHS.map((value) => ({
              value: String(value),
              label: monthsText(value),
            }))}
            value={String(months)}
            onValueChange={(value) => {
              change({ months: Number(value) });
            }}
          />
          {network.kind === 'ppv' ? (
            <p className={styles['muted']}>{NO_TIMESLOT_TEXT}</p>
          ) : (
            <RadioGroup
              legend="Timeslot"
              layout="row"
              options={TIMESLOTS.map((value) => ({ value, label: TIMESLOT_LABELS[value] }))}
              value={timeslot}
              onValueChange={(value) => {
                change({ timeslot: value });
              }}
            />
          )}
          <Switch
            label="Live"
            description="Live shows draw more viewers and earn a little more; taped is the default."
            checked={choice.live}
            onCheckedChange={(checked) => {
              change({ live: checked });
            }}
          />
        </div>
        {valuation === undefined ? (
          <p role="status" className={styles['muted']}>
            {preview.status === 'error' && preview.error?.kind === 'rejected'
              ? (preview.error.reasons[0]?.message ?? 'The network could not be asked.')
              : 'Asking the network…'}
          </p>
        ) : (
          <ProposalPreview valuation={valuation} kind={network.kind} networkName={network.name} />
        )}
        {refusals.length > 0 && (
          <div role="alert" className={styles['refusal']}>
            {refusals.map((reason) => (
              <p key={`${reason.code}:${reason.message}`}>{reason.message}</p>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={network === null ? 'Propose a deal' : `Propose a deal to ${network.name}`}
      size="lg"
      footer={
        <div className={styles['sheetActions']}>
          <Button variant="secondary" onClick={close}>
            Not now
          </Button>
          <Button
            variant="primary"
            disabled={refused}
            loading={propose.pending}
            onClick={() => {
              void submit();
            }}
          >
            Propose deal
          </Button>
        </div>
      }
    >
      {body}
    </Sheet>
  );
}
