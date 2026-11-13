import type { ControlledBy } from '@ringside/engine';
import type { Tone } from '@/components/tone';

/** Who runs a promotion, in words: "You", "Computer", or the other player's name. */
export function controlledByText(
  controlledBy: ControlledBy,
  controllerName: string | null,
): string {
  switch (controlledBy) {
    case 'you':
      return 'You';
    case 'computer':
      return 'Computer';
    case 'otherPlayer':
      return controllerName ?? 'Another player';
  }
}

/** The badge colour for who runs a promotion: yours stands out, the computer's stays quiet. */
export function controlledByTone(controlledBy: ControlledBy): Tone {
  return controlledBy === 'you'
    ? 'action'
    : controlledBy === 'otherPlayer'
      ? 'prestige'
      : 'neutral';
}
