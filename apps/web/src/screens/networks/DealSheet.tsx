import { useState } from 'react';
import { parseId } from '@ringside/engine';
import type { DealId, PromotionId, Reason } from '@ringside/engine';
import { useAnnounce } from '@/app/a11y/LiveAnnouncer';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Button } from '@/components/Button';
import { formatGameDate, useMoneyFormatter } from '@/components/format';
import { Sheet } from '@/components/Sheet';
import { CancelDealDialog } from './CancelDealDialog';
import { dealTitle } from './dealColumns';
import { DealDetailView } from './DealDetailView';
import { formatSlot } from './networkText';
import { RenegotiateView } from './RenegotiateView';
import { useDefaultDealMonths } from './useDefaultDealMonths';
import styles from './Networks.module.css';

export const DEAL_CANCELLED_TEXT = 'Deal cancelled';

/** Stands in for the deal while the sheet is closed; the query is held back then. */
const NO_DEAL = parseId('deal', 'dea_0000000000');

export interface DealSheetProps {
  readonly promotionId: PromotionId;
  /** The open deal (`?deal=`), or null when the sheet is closed. */
  readonly dealId: DealId | null;
  readonly onClose: () => void;
}

/**
 * One deal in a sheet (a bottom sheet on a phone): terms, health with every reason, the airing
 * history, and for a running deal of yours **Renegotiate** (the sheet turns into the renewal
 * preview) and **Cancel deal** (a danger confirm with the exit fee).
 */
export function DealSheet({ promotionId, dealId, onClose }: DealSheetProps) {
  const [shownId, setShownId] = useState<DealId | null>(dealId);
  // Keep the last deal on screen while the sheet slides away.
  if (dealId !== null && dealId !== shownId) setShownId(dealId);
  const [mode, setMode] = useState<'detail' | 'renew'>('detail');
  const [months, setMonths] = useState<number | null>(null);
  const [refusals, setRefusals] = useState<readonly Reason[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const defaultMonths = useDefaultDealMonths();
  const money = useMoneyFormatter();
  const announce = useAnnounce();
  const renegotiate = useEngineCommand('broadcast.renegotiate');
  const clock = useEngineQuery('clock.get', {});
  const deal = useEngineQuery(
    'broadcast.deal',
    { dealId: shownId ?? NO_DEAL },
    { enabled: shownId !== null },
  );
  const today = clock.data?.date ?? null;
  const view = deal.data;
  const own = view?.visibility === 'own' ? view.deal : null;
  const open = dealId !== null;
  const chosenMonths = months ?? defaultMonths;

  const close = (): void => {
    setMode('detail');
    setMonths(null);
    setRefusals([]);
    onClose();
  };

  const renew = async (): Promise<void> => {
    if (own === null) return;
    const result = await renegotiate.run({ dealId: own.dealId, months: chosenMonths });
    if (!result.ok) {
      setRefusals(result.reasons);
      return;
    }
    setRefusals([]);
    setMode('detail');
    announce(`Deal with ${own.networkName} renewed until ${formatGameDate(result.data.endsOn)}`);
  };

  let title = 'Deal';
  let body = <p className={styles['muted']}>Loading the deal…</p>;
  let footer = null;
  if (deal.status === 'error') {
    body = (
      <p>
        {deal.error?.kind === 'rejected'
          ? (deal.error.reasons[0]?.message ?? 'This deal cannot be shown.')
          : 'This deal cannot be shown.'}
      </p>
    );
  } else if (view?.visibility === 'public') {
    title = `${view.deal.networkName} · ${view.deal.showName}`;
    body = <p>{formatSlot(view.deal)}. Only the promotion that signed it sees its money.</p>;
  } else if (own !== null) {
    title = mode === 'renew' ? `Renew: ${dealTitle(own)}` : dealTitle(own);
    const running = own.status === 'active';
    if (mode === 'renew') {
      body = (
        <RenegotiateView
          promotionId={promotionId}
          deal={own}
          months={chosenMonths}
          onMonthsChange={(next) => {
            setMonths(next);
            setRefusals([]);
          }}
          today={today}
          money={money}
          refusals={refusals}
        />
      );
      footer = (
        <div className={styles['sheetActions']}>
          <Button
            variant="secondary"
            onClick={() => {
              setMode('detail');
              setRefusals([]);
            }}
          >
            Back
          </Button>
          <Button
            variant="primary"
            loading={renegotiate.pending}
            onClick={() => {
              void renew();
            }}
          >
            Renew
          </Button>
        </div>
      );
    } else {
      body = <DealDetailView deal={own} money={money} today={today} />;
      footer = running ? (
        <div className={styles['sheetActions']}>
          <Button
            variant="danger"
            onClick={() => {
              setCancelOpen(true);
            }}
          >
            Cancel deal
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setMode('renew');
            }}
          >
            Renegotiate
          </Button>
        </div>
      ) : null;
    }
  }

  return (
    <>
      <Sheet open={open} onClose={close} title={title} size="lg" footer={footer}>
        {body}
      </Sheet>
      {own !== null && own.status === 'active' && (
        <CancelDealDialog
          open={cancelOpen}
          dealId={own.dealId}
          networkName={own.networkName}
          onClose={() => {
            setCancelOpen(false);
          }}
          onCancelled={() => {
            setCancelOpen(false);
            announce(DEAL_CANCELLED_TEXT);
            close();
          }}
        />
      )}
    </>
  );
}
