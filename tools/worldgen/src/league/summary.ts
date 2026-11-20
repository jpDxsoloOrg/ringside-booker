/** A few lines on the league roster step, for the build command's output. */

import { compareText } from '../stats';
import type { LeagueBuild } from './roster';

export function formatLeagueSummary(league: LeagueBuild): string {
  const byPromotion = new Map<string, Map<string, number>>();
  for (const member of league.members) {
    const where = member.promotionKey ?? 'free agent';
    const counts = byPromotion.get(where) ?? new Map<string, number>();
    counts.set(member.rating.division, (counts.get(member.rating.division) ?? 0) + 1);
    byPromotion.set(where, counts);
  }
  const lines = [
    '',
    `League roster: ${String(league.members.length)} wrestlers, ${String(league.teams.length)} teams, ${String(league.reigns.length)} title reigns`,
    `  bios ${String(league.members.filter((member) => member.league.bio !== null).length)}, moves ${String(
      league.members.filter(
        (member) => member.league.finishers.length + member.league.signatures.length > 0,
      ).length,
    )}`,
    `  ring names already in the world (left out): ${league.nameClashes.join(', ') || 'none'}`,
    `  blocked at build time: ${String(league.blocked.length)}`,
    ...[...byPromotion.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([where, counts]) => {
        const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
        const parts = [...counts.entries()]
          .sort(([left], [right]) => compareText(left, right))
          .map(([division, count]) => `${division} ${String(count)}`)
          .join(', ');
        return `  ${where.padEnd(22)} ${String(total).padStart(3)} (${parts})`;
      }),
  ];
  return `${lines.join('\n')}\n`;
}
