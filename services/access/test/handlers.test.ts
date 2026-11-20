import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  type UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { codeIdOf } from '../src/codes.js';
import { makeHandlers } from '../src/handlers.js';
import { CodeStore, type CodeRecord } from '../src/store.js';
import {
  decodeToken,
  encodeToken,
  GRACE_SECONDS,
  generateKeyPair,
  privateKeyFrom,
  publicKeyFrom,
} from '../src/token.js';

const NOW = 1_795_000_000;
const CODE = 'RB-7K3M-Q9TX';
const INSTALL = 'install-0001';
const pair = generateKeyPair();
const keys = {
  privateKey: privateKeyFrom(pair.privateKeyPkcs8),
  publicKey: publicKeyFrom(pair.publicKeyRaw),
};

const ddb = mockClient(DynamoDBDocumentClient);

function record(overrides: Partial<CodeRecord> = {}): CodeRecord {
  return {
    codeId: codeIdOf(CODE),
    code: CODE,
    label: 'Sam',
    channel: 'alpha',
    maxActivations: 2,
    installs: {},
    installCount: 0,
    revoked: false,
    created: NOW - 1000,
    ...overrides,
  };
}

function conditionFailed(): ConditionalCheckFailedException {
  return new ConditionalCheckFailedException({
    message: 'The conditional request failed',
    $metadata: {},
  });
}

type UpdateKind = 'rate' | 'rateReset' | 'touch' | 'add';

function kindOf(input: UpdateCommandInput): UpdateKind {
  const expression = input.UpdateExpression ?? '';
  if (expression.startsWith('SET rateCount')) return 'rate';
  if (expression.startsWith('SET rateWindow')) return 'rateReset';
  if (expression.includes('#last')) return 'touch';
  return 'add';
}

/** Which conditional updates fail; everything else succeeds. */
function updates(failing: Partial<Record<UpdateKind, boolean>>): void {
  ddb.on(UpdateCommand).callsFake((input: UpdateCommandInput) => {
    if (failing[kindOf(input)] === true) throw conditionFailed();
    return {};
  });
}

function event(body: unknown): APIGatewayProxyEventV2 {
  return { body: typeof body === 'string' ? body : JSON.stringify(body) } as APIGatewayProxyEventV2;
}

function parse(result: APIGatewayProxyStructuredResultV2): Record<string, unknown> {
  return JSON.parse(String(result.body)) as Record<string, unknown>;
}

const handlers = makeHandlers({
  store: new CodeStore(DynamoDBDocumentClient.from(new DynamoDBClient({})), 'codes'),
  keys: () => Promise.resolve(keys),
  now: () => NOW,
});

beforeEach(() => {
  ddb.reset();
});

describe('activate', () => {
  it('issues a signed token for a good code', async () => {
    ddb.on(GetCommand).resolves({ Item: record() });
    updates({ touch: true });
    const result = await handlers.activate(
      event({ code: ' rb-7k3m q9tx ', installId: INSTALL, channel: 'alpha' }),
    );
    expect(result.statusCode).toBe(200);
    const body = parse(result);
    const payload = decodeToken(body['token'], keys.publicKey);
    expect(payload).toEqual({
      v: 1,
      cid: codeIdOf(CODE),
      ch: 'alpha',
      iid: INSTALL,
      hint: 'RB-7K3M',
      iat: NOW,
      exp: NOW + GRACE_SECONDS,
    });
    expect(body['expires']).toBe(NOW + GRACE_SECONDS);
    expect(JSON.stringify(payload)).not.toContain('Q9TX');
  });

  it('never lets the token outlive the code', async () => {
    ddb.on(GetCommand).resolves({ Item: record({ expires: NOW + 3600 }) });
    updates({ touch: true });
    const body = parse(await handlers.activate(event({ code: CODE, installId: INSTALL })));
    expect(decodeToken(body['token'], keys.publicKey)?.exp).toBe(NOW + 3600);
  });

  it('re-issues for a computer that already has the code without counting it again', async () => {
    ddb.on(GetCommand).resolves({ Item: record({ installCount: 2 }) });
    updates({});
    const result = await handlers.activate(event({ code: CODE, installId: INSTALL }));
    expect(result.statusCode).toBe(200);
    const adds = ddb
      .commandCalls(UpdateCommand)
      .filter((call) => kindOf(call.args[0].input) === 'add');
    expect(adds).toHaveLength(0);
  });

  it('refuses a code that is not in the table', async () => {
    ddb.on(GetCommand).resolves({});
    const result = await handlers.activate(event({ code: CODE, installId: INSTALL }));
    expect(result.statusCode).toBe(403);
    expect(parse(result)['error']).toBe('invalid_code');
  });

  it('refuses something that cannot be a code without asking the table', async () => {
    const result = await handlers.activate(event({ code: 'RB-0OIL-1111', installId: INSTALL }));
    expect(parse(result)['error']).toBe('invalid_code');
    expect(ddb.commandCalls(GetCommand)).toHaveLength(0);
  });

  it.each([
    ['not json', 'nope'],
    ['no install id', { code: CODE }],
    ['a bad install id', { code: CODE, installId: 'x' }],
    ['an unknown channel', { code: CODE, installId: INSTALL, channel: 'dev' }],
  ])('answers bad_request for %s', async (_name, body) => {
    const result = await handlers.activate(event(body));
    expect(result.statusCode).toBe(400);
    expect(parse(result)['error']).toBe('bad_request');
  });

  it.each([
    ['revoked', record({ revoked: true })],
    ['expired', record({ expires: NOW - 1 })],
  ])('refuses a %s code', async (error, item) => {
    ddb.on(GetCommand).resolves({ Item: item });
    updates({});
    expect(parse(await handlers.activate(event({ code: CODE, installId: INSTALL })))['error']).toBe(
      error,
    );
  });

  it('keeps beta codes off alpha builds, and lets alpha codes into beta builds', async () => {
    ddb.on(GetCommand).resolves({ Item: record({ channel: 'beta' }) });
    updates({ touch: true });
    const wrong = await handlers.activate(
      event({ code: CODE, installId: INSTALL, channel: 'alpha' }),
    );
    expect(parse(wrong)['error']).toBe('wrong_channel');

    ddb.on(GetCommand).resolves({ Item: record({ channel: 'alpha' }) });
    const right = await handlers.activate(
      event({ code: CODE, installId: INSTALL, channel: 'beta' }),
    );
    expect(right.statusCode).toBe(200);
  });

  it('refuses a new computer once the code is on its maximum', async () => {
    ddb.on(GetCommand).resolves({ Item: record({ installCount: 2 }) });
    updates({ touch: true, add: true });
    const result = await handlers.activate(event({ code: CODE, installId: INSTALL }));
    expect(result.statusCode).toBe(403);
    expect(parse(result)['error']).toBe('too_many_computers');
  });

  it('sends the computer limit to the table as the condition', async () => {
    ddb.on(GetCommand).resolves({ Item: record({ maxActivations: 3 }) });
    updates({ touch: true });
    await handlers.activate(event({ code: CODE, installId: INSTALL }));
    const add = ddb
      .commandCalls(UpdateCommand)
      .find((call) => kindOf(call.args[0].input) === 'add');
    expect(add?.args[0].input.ExpressionAttributeValues?.[':max']).toBe(3);
    expect(add?.args[0].input.ExpressionAttributeNames?.['#iid']).toBe(INSTALL);
  });

  it('answers rate_limited when the code has used its hour', async () => {
    ddb.on(GetCommand).resolves({ Item: record() });
    updates({ rate: true, rateReset: true });
    const result = await handlers.activate(event({ code: CODE, installId: INSTALL }));
    expect(result.statusCode).toBe(429);
    expect(parse(result)['error']).toBe('rate_limited');
  });

  it('starts a new hour of calls when the old one is over', async () => {
    ddb.on(GetCommand).resolves({ Item: record() });
    updates({ rate: true, touch: true });
    expect((await handlers.activate(event({ code: CODE, installId: INSTALL }))).statusCode).toBe(
      200,
    );
  });

  it('answers server_error without logging the request', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    ddb.on(GetCommand).rejects(new Error(`boom ${CODE}`));
    const result = await handlers.activate(event({ code: CODE, installId: INSTALL }));
    expect(result.statusCode).toBe(500);
    expect(JSON.stringify(log.mock.calls)).not.toContain('Q9TX');
    log.mockRestore();
  });
});

describe('refresh', () => {
  function token(overrides: Partial<{ iat: number; exp: number; iid: string }> = {}): string {
    return encodeToken(
      {
        v: 1,
        cid: codeIdOf(CODE),
        ch: 'alpha',
        iid: INSTALL,
        hint: 'RB-7K3M',
        iat: NOW - 8 * 86400,
        exp: NOW + 22 * 86400,
        ...overrides,
      },
      keys.privateKey,
    );
  }

  it('re-issues a token with a fresh grace', async () => {
    ddb
      .on(GetCommand)
      .resolves({ Item: record({ installs: { [INSTALL]: { first: 1, last: 1 } } }) });
    updates({});
    const result = await handlers.refresh(event({ token: token() }));
    expect(result.statusCode).toBe(200);
    const payload = decodeToken(parse(result)['token'], keys.publicKey);
    expect(payload?.iat).toBe(NOW);
    expect(payload?.exp).toBe(NOW + GRACE_SECONDS);
    expect(payload?.iid).toBe(INSTALL);
  });

  it('accepts an expired token when the code still works', async () => {
    ddb.on(GetCommand).resolves({ Item: record() });
    updates({});
    const result = await handlers.refresh(
      event({ token: token({ iat: NOW - 60 * 86400, exp: NOW - 30 * 86400 }) }),
    );
    expect(result.statusCode).toBe(200);
  });

  it('refuses a token signed with another key', async () => {
    const other = generateKeyPair();
    const forged = encodeToken(
      {
        v: 1,
        cid: codeIdOf(CODE),
        ch: 'alpha',
        iid: INSTALL,
        hint: 'RB-7K3M',
        iat: NOW,
        exp: NOW + 1,
      },
      privateKeyFrom(other.privateKeyPkcs8),
    );
    expect(parse(await handlers.refresh(event({ token: forged })))['error']).toBe('invalid_token');
  });

  it('refuses a token whose payload was changed', async () => {
    const [, signature] = token().split('.');
    const changed = Buffer.from(
      JSON.stringify({
        v: 1,
        cid: 'cother',
        ch: 'beta',
        iid: INSTALL,
        hint: 'x',
        iat: NOW,
        exp: NOW + 99,
      }),
    ).toString('base64url');
    expect(
      parse(await handlers.refresh(event({ token: `${changed}.${String(signature)}` })))['error'],
    ).toBe('invalid_token');
    expect(ddb.commandCalls(GetCommand)).toHaveLength(0);
  });

  it('reports a revoked code', async () => {
    ddb.on(GetCommand).resolves({ Item: record({ revoked: true }) });
    updates({});
    expect(parse(await handlers.refresh(event({ token: token() })))['error']).toBe('revoked');
  });

  it('reports a deleted code as revoked', async () => {
    ddb.on(GetCommand).resolves({});
    expect(parse(await handlers.refresh(event({ token: token() })))['error']).toBe('revoked');
  });

  it('reports a computer the owner reset as not activated', async () => {
    ddb.on(GetCommand).resolves({ Item: record() });
    updates({ touch: true });
    expect(parse(await handlers.refresh(event({ token: token() })))['error']).toBe('not_activated');
  });
});

describe('keys', () => {
  it('round-trips the stored key formats', () => {
    const fresh = generateKeyPair();
    expect(Buffer.from(fresh.publicKeyRaw, 'base64')).toHaveLength(32);
    const derived = createPublicKey(
      createPrivateKey({
        key: Buffer.from(fresh.privateKeyPkcs8, 'base64'),
        format: 'der',
        type: 'pkcs8',
      }),
    );
    expect(derived.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')).toBe(
      fresh.publicKeyRaw,
    );
  });
});
