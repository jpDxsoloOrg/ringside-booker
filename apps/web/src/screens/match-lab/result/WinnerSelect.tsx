import type { PlannedWinner } from '@ringside/engine';
import { RadioGroup } from '@/components/RadioGroup';
import type { RadioOption } from '@/components/RadioGroup';
import { useIsMobile } from '@/styles/useMediaQuery';
import styles from './Result.module.css';
import {
  RANDOM_WINNERS_AUTO_DESCRIPTION,
  RANDOM_WINNERS_AUTO_LABEL,
  sideOptionLabel,
  winnerFromValue,
  winnerValue,
} from './resultText';

export interface WinnerSelectProps {
  /** The names on each built side, in stored side order. */
  readonly sides: readonly (readonly string[])[];
  readonly value: PlannedWinner;
  readonly onValueChange: (winner: PlannedWinner) => void;
  /** True in a Random winners game: Auto says the winner is decided on the night. */
  readonly randomWinners: boolean;
  readonly disabled?: boolean;
}

/**
 * Who wins on Simulate: Auto, one option per built side ("Side 2: names", the names cut short with
 * an ellipsis but read out in full) or a Draw. Side by side on desktop, stacked on a phone.
 */
export function WinnerSelect({
  sides,
  value,
  onValueChange,
  randomWinners,
  disabled = false,
}: WinnerSelectProps) {
  const isMobile = useIsMobile();
  const auto: RadioOption<string> = randomWinners
    ? {
        value: 'auto',
        label: RANDOM_WINNERS_AUTO_LABEL,
        description: RANDOM_WINNERS_AUTO_DESCRIPTION,
      }
    : { value: 'auto', label: 'Auto' };
  const options: readonly RadioOption<string>[] = [
    auto,
    ...sides.map((names, side) => ({
      value: winnerValue({ side }),
      label: <span className={styles['sideName']}>{sideOptionLabel(side, names)}</span>,
    })),
    { value: 'draw', label: 'Draw' },
  ];
  return (
    <RadioGroup
      legend="Winner"
      layout={isMobile ? 'column' : 'row'}
      options={options}
      value={winnerValue(value)}
      disabled={disabled}
      onValueChange={(picked) => {
        const winner = winnerFromValue(picked);
        if (winner !== null) onValueChange(winner);
      }}
    />
  );
}
