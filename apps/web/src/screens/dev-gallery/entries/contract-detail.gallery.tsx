import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import { Stack } from '@/components/layout';
import { ContractDetailView } from '@/screens/contracts/ContractDetailView';
import { anAnswerPreview, anOwnDetail, aPrivateDetail } from '@/screens/contracts/contractFixtures';
import { contractRulesOf } from '@/screens/contracts/useContractRules';
import type { GalleryEntry } from '../galleryEntry';
import { createTraceFixtureTransport } from '../fixtures/traceEngine';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';
import office from './office.module.css';

/** The engine's default contract rules: the stops on, Normal patience, automatic renewals. */
const RULES = contractRulesOf([], false);

function createContractTransport(): EngineTransport {
  return createTraceFixtureTransport([], 300, {
    'contracts.answerPreview': () => anAnswerPreview(),
  });
}

function Example({
  title,
  children,
  narrow = false,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly narrow?: boolean;
}) {
  return (
    <section className={styles['example']}>
      <h3 className={styles['subheading']}>{title}</h3>
      <div className={office['stage']}>
        <div className={narrow ? broadcast['phoneColumn'] : office['sideColumn']}>{children}</div>
      </div>
    </section>
  );
}

function ContractDetailDemo() {
  const noop = () => undefined;
  return (
    <EngineProvider createTransport={createContractTransport}>
      <Stack gap={5}>
        <Example title="Your worker, asking to leave">
          <ContractDetailView detail={anOwnDetail()} rules={RULES} onAnswered={noop} />
        </Example>
        <Example title="After a refusal: the walk-out chance">
          <ContractDetailView
            detail={anOwnDetail({
              request: {
                status: 'refused',
                raisedOn: anOwnDetail().request?.raisedOn ?? anOwnDetail().startsOn,
                answerBy: anOwnDetail().request?.answerBy ?? anOwnDetail().startsOn,
              },
              walkout: { chance: 0.025, traceRef: null },
            })}
            rules={RULES}
            onAnswered={noop}
          />
        </Example>
        <Example title="Your worker, content, with perks and a title">
          <ContractDetailView
            detail={anOwnDetail({
              request: null,
              unhappy: null,
              morale: 12,
              perks: ['ironClad', 'travelCovered'],
              titles: [],
            })}
            rules={RULES}
            onAnswered={noop}
          />
        </Example>
        <Example title="A rival's contract">
          <ContractDetailView detail={aPrivateDetail()} rules={RULES} onAnswered={noop} />
        </Example>
        <Example title="Phone width (390px)" narrow>
          <ContractDetailView detail={anOwnDetail()} rules={RULES} onAnswered={noop} />
        </Example>
      </Stack>
    </EngineProvider>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'contract-detail',
  title: 'ContractDetailView',
  group: 'Office',
  notes:
    'One contract as the Contracts sheet and the profile\'s Contract tab show it (ECO4-04). Your own: every term with the severance it would cost today (Why?), the dates, the automatic renewal said plainly, morale and the unhappy clock, and a request to leave with both answers (Grant pays, Refuse costs morale and a daily walk-out chance), each with a Why?. A rival\'s shows only the promotion, kind and dates, with "Terms private".',
  render: () => <ContractDetailDemo />,
};
