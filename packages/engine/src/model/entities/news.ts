/**
 * News: the public stories of the wrestling world (results, title changes, signings, rumours).
 *
 * Headlines and bodies are templated text, like mail. Which stories get written and their text
 * catalogs belong to the systems that publish them; the UI renders the templates. Every story goes in
 * through `postNews` (systems/news), which scores its buzz and sets its expiry.
 * Design: docs/design/news.md.
 */

import { z } from 'zod';
import { zGameDate, zId, zTemplatedText } from '../primitives';
import { defineTable } from '../table-def';
import { MessageRefsSchema } from './mail';

export const NEWS_KINDS = [
  'result',
  'titleChange',
  'signing',
  'release',
  'injury',
  'retirement',
  'rumour',
  'business',
  'milestone',
  'backstage',
  'personal',
  'season',
  'award',
  'rivalry',
] as const;
export const NewsKindSchema = z.enum(NEWS_KINDS);
export type NewsKind = z.infer<typeof NewsKindSchema>;

/** What each kind of story is called on screen. */
export const NEWS_KIND_LABELS: Readonly<Record<NewsKind, string>> = {
  result: 'Result',
  titleChange: 'Title change',
  signing: 'Signing',
  release: 'Release',
  injury: 'Injury',
  retirement: 'Retirement',
  rumour: 'Rumour',
  business: 'Business',
  milestone: 'Milestone',
  backstage: 'Backstage',
  personal: 'Personal',
  season: 'Season',
  award: 'Award',
  rivalry: 'Rivalry',
};

/** Longest dedupe key a story can carry. */
export const NEWS_DEDUPE_KEY_MAX = 160;

/** How prominently a story is shown: 0 is filler, 3 is front page. */
export const NewsImportanceSchema = z.literal([0, 1, 2, 3]);
export type NewsImportance = z.infer<typeof NewsImportanceSchema>;

export const NewsSchema = z.strictObject({
  id: zId('news'),
  date: zGameDate,
  kind: NewsKindSchema,
  headline: zTemplatedText,
  body: zTemplatedText,
  refs: MessageRefsSchema,
  importance: NewsImportanceSchema,
  /** The day the story drops off the feed, or null to keep it. */
  expiresOn: zGameDate.nullable(),
  /**
   * How much the wrestling world is talking about the story, 0..100, fixed when it was posted
   * (`buzzScore`; the full working is the story's `news.buzz` trace). A story saved before buzz
   * existed (DAY1-01) loads with 0.
   */
  buzz: z.number().min(0).max(100).default(0),
  /**
   * The poster's "only once" key, such as `title-change:<reignId>`: `postNews` posts nothing when a
   * story with the same key exists. Null when the story can be posted any number of times, and
   * for a story saved before dedupe keys existed.
   */
  dedupeKey: z.string().min(1).max(NEWS_DEDUPE_KEY_MAX).nullable().default(null),
});

export type News = z.infer<typeof NewsSchema>;

export const newsTable = defineTable({
  kind: 'news',
  name: 'news',
  schema: NewsSchema,
  refs: [
    { path: 'refs.personIds[]', target: 'person', nullable: false },
    { path: 'refs.promotionIds[]', target: 'promotion', nullable: false },
    { path: 'refs.eventInstanceId', target: 'eventInstance', nullable: true },
    { path: 'refs.employmentId', target: 'employment', nullable: true },
  ],
  indexes: [
    { name: 'byDate', key: (news) => news.date },
    { name: 'byDedupeKey', key: (news) => news.dedupeKey },
    { name: 'byExpiresOn', key: (news) => news.expiresOn },
  ],
});
