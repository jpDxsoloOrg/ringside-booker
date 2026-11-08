/**
 * The saved state of the event bus: the next sequence number and the recent-event log.
 *
 * SIM-10 registers {@link eventBusStateSchema} with the save format as the `events` state part.
 */

import { z } from 'zod';
import { InvalidStatePartError } from '../errors';
import { formatPath, zJsonValue } from '../json';
import { isGameDate, type GameDate } from '../date';
import { EVENT_TYPE_PATTERN, type AnyDomainEvent } from './types';

/** The event bus part of a save. */
export interface EventBusState {
  version: 1;
  /** The last sequence number handed out; the next committed event gets `seq + 1`. */
  seq: number;
  /** The recent-event log, oldest first. */
  recent: AnyDomainEvent[];
}

// Core does not import from model/, so the game date check is spelled out here.
const gameDateSchema = z.custom<GameDate>(isGameDate, {
  error: 'must be a game date in the form YYYY-MM-DD',
});

/**
 * The shape of one stored event. Which payload belongs to which event type is only known at
 * compile time, so on load the payload is checked to be plain JSON and the type to be a
 * well-formed event name; the systems that read an event trust its declared payload type.
 */
const storedEventSchema = z.strictObject({
  type: z
    .string()
    .regex(EVENT_TYPE_PATTERN, { error: 'must be an event type such as "day.started"' }),
  seq: z.number().int().min(1),
  date: gameDateSchema,
  source: z.strictObject({
    kind: z.enum(['phase', 'command', 'reaction']),
    id: z.string().min(1),
  }),
  payload: zJsonValue,
});

/** One stored event: checked against {@link storedEventSchema}, typed as a domain event. */
const domainEventSchema: z.ZodType<AnyDomainEvent> = z
  .custom<AnyDomainEvent>()
  .superRefine((value, ctx) => {
    const result = storedEventSchema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
      }
    }
  });

/** Zod schema for {@link EventBusState}. Also checks that `seq` values are increasing. */
export const eventBusStateSchema: z.ZodType<EventBusState> = z
  .strictObject({
    version: z.literal(1, { error: 'unsupported event bus state version (expected 1)' }),
    seq: z.number().int().min(0),
    recent: z.array(domainEventSchema),
  })
  .superRefine((state, ctx) => {
    let previousSeq = 0;
    state.recent.forEach((event, index) => {
      if (event.seq <= previousSeq) {
        ctx.addIssue({
          code: 'custom',
          message: 'seq must be greater than the previous event seq',
          path: ['recent', index, 'seq'],
        });
      }
      if (event.seq > state.seq) {
        ctx.addIssue({
          code: 'custom',
          message: `seq must not be greater than the bus seq (${String(state.seq)})`,
          path: ['recent', index, 'seq'],
        });
      }
      previousSeq = event.seq;
    });
  });

/**
 * Validates an unknown value (for example straight from `JSON.parse`) as an {@link EventBusState}.
 * Throws {@link InvalidStatePartError} naming every bad field.
 */
export function parseEventBusState(input: unknown): EventBusState {
  const result = eventBusStateSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  throw new InvalidStatePartError(
    'event bus',
    result.error.issues.map((issue) => `${formatPath('$', issue.path)}: ${issue.message}`),
  );
}
