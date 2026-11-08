/** Public surface of the domain event bus. See `docs/design/day-pipeline.md` (Domain events). */

export {
  EventBus,
  type DispatchReport,
  type EventBusOptions,
  type EventObserver,
  type EventStaging,
  type ObserverFailure,
  type PublishEvent,
  type ReactionFailure,
  type ReactionHandler,
  type ReactionOutcome,
  type ReactionRunner,
  type SubscribedEvent,
  type SubscribeOptions,
} from './bus';
export { EventLog, type RecentEventsQuery } from './log';
export { eventBusStateSchema, parseEventBusState, type EventBusState } from './schema';
export {
  EVENT_TYPE_PATTERN,
  isEventOfType,
  isEventOfTypes,
  type AnyDomainEvent,
  type DomainEvent,
  type DomainEventByType,
  type DomainEventMap,
  type EventOf,
  type EventSource,
  type EventSourceKind,
  type EventType,
} from './types';
