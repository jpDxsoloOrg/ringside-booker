/**
 * News: the public stories of the wrestling world (results, title changes, signings, rumours).
 *
 * Headlines and bodies are templated text, like mail. Which stories get written and their text
 * catalogs belong to the systems that publish them; the UI renders the templates.
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
] as const;
export const NewsKindSchema = z.enum(NEWS_KINDS);
export type NewsKind = z.infer<typeof NewsKindSchema>;

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
  indexes: [{ name: 'byDate', key: (news) => news.date }],
});
