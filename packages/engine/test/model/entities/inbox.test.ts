import { describe, expect, it } from 'vitest';
import { MailSchema, type MailDecision } from '../../../src/model/entities/mail';
import { NewsSchema } from '../../../src/model/entities/news';
import { checkWorld } from '../../../src/model/integrity';
import {
  date,
  emptyGeoMediaWorld,
  GEO_MEDIA_REGISTRY,
  makeMail,
  makeNews,
  testId,
  text,
} from '../../support/geo-media-fixtures';

function decision(keys: readonly string[], chosenKey: string | null): MailDecision {
  return {
    options: keys.map((key) => ({ key, label: text(`mail.option.${key}`) })),
    chosenKey,
    expiresOn: date('2026-03-22'),
  };
}

function inboxWorld() {
  const world = emptyGeoMediaWorld();
  world.tables.promotions._put({ id: testId('promotion', 1), status: 'active' });
  world.tables.promotions._put({ id: testId('promotion', 2), status: 'active' });
  world.tables.people._put({ id: testId('person', 1) });
  return world;
}

describe('mail schema', () => {
  it('accepts a mail with an open or answered decision', () => {
    expect(MailSchema.safeParse(makeMail(1)).success).toBe(true);
    expect(
      MailSchema.safeParse(makeMail(1, { decision: decision(['accept', 'decline'], null) }))
        .success,
    ).toBe(true);
    expect(
      MailSchema.safeParse(makeMail(1, { decision: decision(['accept', 'decline'], 'accept') }))
        .success,
    ).toBe(true);
  });

  it('rejects a chosenKey that is not one of the options', () => {
    const result = MailSchema.safeParse(
      makeMail(1, { decision: decision(['accept', 'decline'], 'counter') }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['decision', 'chosenKey']);
  });

  it('rejects six options, one option and duplicate keys', () => {
    const six = decision(['one', 'two', 'three', 'four', 'five', 'six'], null);
    expect(MailSchema.safeParse(makeMail(1, { decision: six })).success).toBe(false);
    expect(MailSchema.safeParse(makeMail(1, { decision: decision(['one'], null) })).success).toBe(
      false,
    );
    expect(
      MailSchema.safeParse(makeMail(1, { decision: decision(['same', 'same'], null) })).success,
    ).toBe(false);
  });

  it('rejects a sender of an unknown kind and a rendered-string subject', () => {
    expect(MailSchema.safeParse({ ...makeMail(1), from: { kind: 'robot' } }).success).toBe(false);
    expect(MailSchema.safeParse({ ...makeMail(1), subject: 'Contract offer' }).success).toBe(false);
  });
});

describe('mail integrity and indexes', () => {
  it('reports mail from a missing person', () => {
    const world = inboxWorld();
    const missingPerson = testId('person', 99);
    world.tables.mail._put(makeMail(1, { from: { kind: 'person', personId: missingPerson } }));
    world.tables.mail._put(
      makeMail(2, { from: { kind: 'person', personId: testId('person', 1) } }),
    );
    world.tables.mail._put(
      makeMail(3, { from: { kind: 'promotion', promotionId: testId('promotion', 2) } }),
    );
    const report = checkWorld(world, GEO_MEDIA_REGISTRY, { validateRows: true });
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'ref.dangling',
        table: 'mail',
        id: testId('mail', 1),
        path: 'from.personId',
        missingId: missingPerson,
      }),
    ]);
  });

  it('files only unread mail under byPromotionUnread and moves it when read', () => {
    const world = inboxWorld();
    world.tables.mail._put(makeMail(1));
    world.tables.mail._put(makeMail(2, { read: true }));
    world.tables.mail._put(makeMail(3, { promotionId: testId('promotion', 2) }));
    const unreadIds = () =>
      world.tables.mail.lookup('byPromotionUnread', testId('promotion', 1)).map((mail) => mail.id);
    expect(unreadIds()).toEqual([testId('mail', 1)]);
    expect(world.tables.mail.lookup('byPromotion', testId('promotion', 1))).toHaveLength(2);

    world.tables.mail._put(makeMail(1, { read: true }));
    expect(unreadIds()).toEqual([]);
  });
});

describe('news', () => {
  it('accepts a valid story and rejects an importance of 4', () => {
    expect(NewsSchema.safeParse(makeNews(1)).success).toBe(true);
    expect(NewsSchema.safeParse({ ...makeNews(1), importance: 4 }).success).toBe(false);
  });

  it('reports a dangling person reference and indexes by date', () => {
    const world = inboxWorld();
    world.tables.news._put(
      makeNews(1, {
        refs: {
          personIds: [testId('person', 1), testId('person', 7)],
          promotionIds: [testId('promotion', 1)],
          eventInstanceId: null,
          employmentId: null,
        },
      }),
    );
    world.tables.news._put(makeNews(2, { date: date('2026-03-16') }));
    expect(checkWorld(world, GEO_MEDIA_REGISTRY).issues).toEqual([
      expect.objectContaining({ code: 'ref.dangling', path: 'refs.personIds[1]' }),
    ]);
    expect(world.tables.news.lookup('byDate', '2026-03-16').map((news) => news.id)).toEqual([
      testId('news', 2),
    ]);
  });
});
