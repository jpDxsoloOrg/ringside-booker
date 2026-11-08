/**
 * Mail: the messages in a promotion's inbox.
 *
 * Subjects, bodies and decision labels are templated text (a content key plus parameters), not
 * rendered English, so saves stay language-neutral and the UI can turn parameters into links. Which
 * mail gets sent and the template catalogs belong to the systems that send it.
 *
 * A mail can carry a decision: two to five options the reader picks from. Until one is chosen
 * (`chosenKey: null`) the day pipeline can stop on it.
 */

import { z } from 'zod';
import { zGameDate, zId, zTemplatedText } from '../primitives';
import { defineTable } from '../table-def';
import { zUniqueIdList } from './id-list';

export const MAIL_CATEGORIES = [
  'contract',
  'discipline',
  'results',
  'finance',
  'request',
  'media',
  'world',
  'system',
] as const;
export const MailCategorySchema = z.enum(MAIL_CATEGORIES);
export type MailCategory = z.infer<typeof MailCategorySchema>;

/** Who a mail is from: a person, another promotion, or the game itself. */
export const MailSenderSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('person'), personId: zId('person') }),
  z.strictObject({ kind: z.literal('promotion'), promotionId: zId('promotion') }),
  z.strictObject({ kind: z.literal('system') }),
]);

export type MailSender = z.infer<typeof MailSenderSchema>;

/** The rows a mail or news item is about, so the UI can link to them. Shared with news. */
export const MessageRefsSchema = z.strictObject({
  personIds: zUniqueIdList('person'),
  promotionIds: zUniqueIdList('promotion'),
  eventInstanceId: zId('eventInstance').nullable(),
  employmentId: zId('employment').nullable(),
});

export type MessageRefs = z.infer<typeof MessageRefsSchema>;

/** Fewest and most options a decision offers. */
export const MAIL_DECISION_OPTIONS_MIN = 2;
export const MAIL_DECISION_OPTIONS_MAX = 5;

/** A decision option key, such as `accept` or `counterOffer`. */
export const DECISION_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

export const MailDecisionOptionSchema = z.strictObject({
  key: z.string().max(32).regex(DECISION_KEY_PATTERN, 'Expected a camelCase option key'),
  label: zTemplatedText,
});

export type MailDecisionOption = z.infer<typeof MailDecisionOptionSchema>;

export const MailDecisionSchema = z
  .strictObject({
    options: z
      .array(MailDecisionOptionSchema)
      .min(MAIL_DECISION_OPTIONS_MIN)
      .max(MAIL_DECISION_OPTIONS_MAX),
    /** The option picked, or null while the decision is open. */
    chosenKey: z.string().nullable(),
    /** The last day to decide, or null when it never expires. */
    expiresOn: zGameDate.nullable(),
  })
  .superRefine((decision, context) => {
    const keys = new Set<string>();
    decision.options.forEach((option, index) => {
      if (keys.has(option.key)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate option key ${option.key}`,
          path: ['options', index, 'key'],
        });
      }
      keys.add(option.key);
    });
    if (decision.chosenKey !== null && !keys.has(decision.chosenKey)) {
      context.addIssue({
        code: 'custom',
        message: `chosenKey ${decision.chosenKey} is not one of the option keys`,
        path: ['chosenKey'],
      });
    }
  });

export type MailDecision = z.infer<typeof MailDecisionSchema>;

export const MailSchema = z.strictObject({
  id: zId('mail'),
  /** The promotion whose inbox this is. */
  promotionId: zId('promotion'),
  date: zGameDate,
  category: MailCategorySchema,
  from: MailSenderSchema,
  subject: zTemplatedText,
  body: zTemplatedText,
  refs: MessageRefsSchema,
  read: z.boolean(),
  archived: z.boolean(),
  decision: MailDecisionSchema.nullable(),
});

export type Mail = z.infer<typeof MailSchema>;

export const mailTable = defineTable({
  kind: 'mail',
  name: 'mail',
  schema: MailSchema,
  refs: [
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'from.personId', target: 'person', nullable: false },
    { path: 'from.promotionId', target: 'promotion', nullable: false },
    { path: 'refs.personIds[]', target: 'person', nullable: false },
    { path: 'refs.promotionIds[]', target: 'promotion', nullable: false },
    { path: 'refs.eventInstanceId', target: 'eventInstance', nullable: true },
    { path: 'refs.employmentId', target: 'employment', nullable: true },
  ],
  indexes: [
    { name: 'byPromotion', key: (mail) => mail.promotionId },
    { name: 'byPromotionUnread', key: (mail) => (mail.read ? null : mail.promotionId) },
  ],
});
