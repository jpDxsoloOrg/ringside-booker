import type { NewsItemView, NewsNames } from '@ringside/engine';
import type { ImageSubject } from '@/components/ImageSlot';
import type { TextNames } from '@/text/renderTemplatedText';

/** One entity a story is about, with its name from the query's `names`. */
export interface NewsEntity {
  readonly id: string;
  readonly kind: TextNames[string]['kind'];
  readonly name: string;
}

/**
 * Everyone and everything a story is about, from its refs: people, then promotions, then its
 * show. Ids the names do not hold are left out.
 */
export function newsEntitiesOf(item: NewsItemView, names: NewsNames): NewsEntity[] {
  const ids = [
    ...item.refs.personIds,
    ...item.refs.promotionIds,
    ...(item.refs.eventInstanceId === null ? [] : [item.refs.eventInstanceId]),
  ];
  const entities: NewsEntity[] = [];
  for (const id of new Set(ids)) {
    const named = Object.hasOwn(names, id) ? names[id] : undefined;
    if (named !== undefined) entities.push({ id, kind: named.kind, name: named.name });
  }
  return entities;
}

/** The picture a story leads with: its first person, else its first promotion, else none. */
export function newsSubjectOf(item: NewsItemView, names: NewsNames): ImageSubject | null {
  const entities = newsEntitiesOf(item, names);
  const lead =
    entities.find((entity) => entity.kind === 'person') ??
    entities.find((entity) => entity.kind === 'promotion');
  if (lead === undefined) return null;
  return { kind: lead.kind === 'person' ? 'person' : 'promotion', id: lead.id, name: lead.name };
}
