/**
 * Builders for mail and news.
 *
 * Defaults:
 *
 * - mail: an unread system message in `pro_0000000001`'s inbox on `TEST_START_DATE`, with
 *   templated subject and body (`mail.test-subject`, `mail.test-body`), no references and no
 *   decision;
 * - news: a business story of importance 1 on `TEST_START_DATE` that never expires, with templated
 *   headline and body (`news.test-headline`, `news.test-body`) and no references.
 */

import { parseContentKey } from '../../../src/core/content-key';
import { MailSchema, type Mail, type MessageRefs } from '../../../src/model/entities/mail';
import { NewsSchema, type News } from '../../../src/model/entities/news';
import { TestIds, testId, type TestIdSequence } from '../ids';
import { buildRow, TEST_START_DATE, type DeepPartial } from './build-row';

function noRefs(): MessageRefs {
  return { personIds: [], promotionIds: [], eventInstanceId: null, employmentId: null };
}

export function aMail(overrides: DeepPartial<Mail> = {}, sequence: TestIdSequence = TestIds): Mail {
  const defaults: Mail = {
    id: overrides.id ?? sequence.id('mail'),
    promotionId: testId('promotion'),
    date: TEST_START_DATE,
    category: 'system',
    from: { kind: 'system' },
    subject: { key: parseContentKey('mail.test-subject'), params: {} },
    body: { key: parseContentKey('mail.test-body'), params: {} },
    refs: noRefs(),
    read: false,
    archived: false,
    decision: null,
  };
  return buildRow(MailSchema, 'aMail', defaults, overrides);
}

export function aNews(overrides: DeepPartial<News> = {}, sequence: TestIdSequence = TestIds): News {
  const defaults: News = {
    id: overrides.id ?? sequence.id('news'),
    date: TEST_START_DATE,
    kind: 'business',
    headline: { key: parseContentKey('news.test-headline'), params: {} },
    body: { key: parseContentKey('news.test-body'), params: {} },
    refs: noRefs(),
    importance: 1,
    expiresOn: null,
  };
  return buildRow(NewsSchema, 'aNews', defaults, overrides);
}
