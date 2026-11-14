import type { TitleCardRow } from '@ringside/engine';
import { PersonProfileLink, TitlePageLink } from '@/app/entityLinks';
import { Badge } from '@/components/Badge';
import { ChampionCard } from '@/components/ChampionCard';
import type {
  ChampionCardHeadingLevel,
  ChampionCardReign,
  ChampionCardTitle,
} from '@/components/ChampionCard';
import { formatGameDate } from '@/components/format';
import { StatBar } from '@/components/StatBar';
import { traceSourceOf, WhyButton } from '@/components/Trace';
import { beltTierOf } from './beltTier';
import styles from './Titles.module.css';

/** The words on the Why? beside a card's prestige: "Why? World Championship prestige 82". */
export function prestigeWhyLabel(row: Pick<TitleCardRow, 'name' | 'prestige'>): string {
  return `Why? ${row.name} prestige ${String(Math.round(row.prestige))}`;
}

/** The card's belt: the title's art, or a placeholder belt in the metal its prestige earns. */
export function titleCardTitle(row: TitleCardRow): ChampionCardTitle {
  return {
    id: row.titleId,
    name: row.name,
    tier: beltTierOf(row.prestige),
    ...(row.imageRef === null ? {} : { imageRef: row.imageRef }),
  };
}

/**
 * The card's reign: the champion under the name the lineage gives the reign (a team's name, or the
 * names they won it under), drawn with the first holder's picture. Null when the title is vacant.
 */
export function titleCardReign(row: TitleCardRow): ChampionCardReign | null {
  const { champion } = row;
  if (champion === null) return null;
  const [first] = champion.holders;
  return {
    champion: {
      kind: 'person',
      id: first?.personId ?? champion.reignId,
      name: champion.label,
      ...(first === undefined || first.imageRef === null ? {} : { imageRef: first.imageRef }),
    },
    days: champion.daysHeld,
    defences: champion.defences,
  };
}

export interface TitleCardProps {
  readonly row: TitleCardRow;
  /** The title name's heading level. 3 by default, under a group's panel heading. */
  readonly headingLevel?: ChampionCardHeadingLevel;
}

/**
 * One title from `titles.list` as a `ChampionCard`: belt in its prestige's metal, the name linking
 * to the title's page, the champion (linking to their profile when there is one holder) or
 * "Vacant", reign days, defences, prestige with its Why?, and a prestige bar with "Retired <date>"
 * for a retired title. Read-only: the actions come with CRTV1-05.
 */
export function TitleCard({ row, headingLevel = 3 }: TitleCardProps) {
  const source = traceSourceOf(row.prestigeTrace, row.prestigeTraceRef);
  const [onlyHolder, ...others] = row.champion?.holders ?? [];
  const soloHolder = onlyHolder !== undefined && others.length === 0 ? onlyHolder : null;
  return (
    <ChampionCard
      title={titleCardTitle(row)}
      reign={titleCardReign(row)}
      prestige={row.prestige}
      headingLevel={headingLevel}
      renderTitleName={(name) => <TitlePageLink titleId={row.titleId}>{name}</TitlePageLink>}
      {...(soloHolder === null
        ? {}
        : {
            renderChampionName: (name: string) => (
              <PersonProfileLink personId={soloHolder.personId}>{name}</PersonProfileLink>
            ),
          })}
      {...(source === null
        ? {}
        : {
            why: (
              <WhyButton
                label="Prestige"
                value={row.prestige}
                buttonLabel={prestigeWhyLabel(row)}
                panelTitle={`Prestige: ${row.name}`}
                source={source}
              />
            ),
          })}
      footer={
        <div className={styles['cardFooter']}>
          {/* The number is in the card's header already ("Prestige 92"), so the bar stands alone. */}
          <StatBar
            label="Prestige"
            hideLabel
            showValue={false}
            value={row.prestige}
            className={styles['cardBar']}
          />
          {row.status === 'retired' && row.retiredOn !== null && (
            <Badge tone="neutral">{`Retired ${formatGameDate(row.retiredOn)}`}</Badge>
          )}
        </div>
      }
    />
  );
}
