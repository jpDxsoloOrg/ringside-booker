import type { KeyObject } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  channelOpens,
  codeHint,
  codeIdOf,
  isChannel,
  isInstallId,
  normaliseCode,
} from './codes.js';
import type { CodeRecord, CodeStore } from './store.js';
import { decodeToken, encodeToken, expiryFor, type TokenPayload } from './token.js';

/**
 * What a refused call says. The game turns each into plain words (Release/Access/AccessMessages.cs),
 * so these names are part of the contract.
 */
export type ErrorCode =
  | 'bad_request'
  | 'invalid_code'
  | 'revoked'
  | 'expired'
  | 'wrong_channel'
  | 'too_many_computers'
  | 'not_activated'
  | 'invalid_token'
  | 'rate_limited'
  | 'server_error';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  invalid_code: 403,
  revoked: 403,
  expired: 403,
  wrong_channel: 403,
  too_many_computers: 403,
  not_activated: 403,
  invalid_token: 403,
  rate_limited: 429,
  server_error: 500,
};

export interface Keys {
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export interface Deps {
  store: CodeStore;
  keys: () => Promise<Keys>;
  /** Unix seconds. */
  now: () => number;
}

type Result = APIGatewayProxyStructuredResultV2;

function reply(status: number, body: Record<string, unknown>): Result {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function refuse(error: ErrorCode): Result {
  return reply(STATUS[error], { ok: false, error });
}

function readBody(event: APIGatewayProxyEventV2): Record<string, unknown> | null {
  if (event.body === undefined || event.body.length > 4096) return null;
  try {
    const text = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Why a code can't be used right now, or null when it can. */
function codeProblem(record: CodeRecord, now: number): ErrorCode | null {
  if (record.revoked) return 'revoked';
  if (record.expires !== undefined && record.expires <= now) return 'expired';
  return null;
}

async function issue(deps: Deps, record: CodeRecord, installId: string, now: number) {
  const payload: TokenPayload = {
    v: 1,
    cid: record.codeId,
    ch: record.channel,
    iid: installId,
    hint: codeHint(record.code),
    iat: now,
    exp: expiryFor(now, record.expires),
  };
  const { privateKey } = await deps.keys();
  return reply(200, { ok: true, token: encodeToken(payload, privateKey), expires: payload.exp });
}

function guard(work: () => Promise<Result>): Promise<Result> {
  return work().catch((error: unknown) => {
    // Log the kind of failure only: never the request body (it holds a code).
    console.error('access: server error', error instanceof Error ? error.name : typeof error);
    return refuse('server_error');
  });
}

export function makeHandlers(deps: Deps) {
  /** `POST /activate { code, installId, channel? }` → `{ ok, token, expires }`. */
  async function activate(event: APIGatewayProxyEventV2): Promise<Result> {
    return guard(async () => {
      const body = readBody(event);
      if (body === null) return refuse('bad_request');
      const installId = body['installId'];
      if (!isInstallId(installId)) return refuse('bad_request');
      const buildChannel = body['channel'];
      if (buildChannel !== undefined && !isChannel(buildChannel)) return refuse('bad_request');
      const code = normaliseCode(body['code']);
      if (code === null) return refuse('invalid_code');

      const now = deps.now();
      const record = await deps.store.get(codeIdOf(code));
      if (record?.code !== code) return refuse('invalid_code');
      if (!(await deps.store.takeRateSlot(record.codeId, now))) return refuse('rate_limited');
      const problem = codeProblem(record, now);
      if (problem !== null) return refuse(problem);
      if (buildChannel !== undefined && !channelOpens(record.channel, buildChannel)) {
        return refuse('wrong_channel');
      }
      const added = await deps.store.addInstall(
        record.codeId,
        installId,
        now,
        record.maxActivations,
      );
      if (added === 'full') return refuse('too_many_computers');
      return issue(deps, record, installId, now);
    });
  }

  /**
   * `POST /refresh { token }` → a new token. An expired token is fine (the signature proves the
   * game had it); the table decides whether the code still works on that computer.
   */
  async function refresh(event: APIGatewayProxyEventV2): Promise<Result> {
    return guard(async () => {
      const body = readBody(event);
      if (body === null) return refuse('bad_request');
      const { publicKey } = await deps.keys();
      const payload = decodeToken(body['token'], publicKey);
      if (payload === null) return refuse('invalid_token');

      const now = deps.now();
      const record = await deps.store.get(payload.cid);
      if (record === undefined) return refuse('revoked');
      if (!(await deps.store.takeRateSlot(record.codeId, now))) return refuse('rate_limited');
      const problem = codeProblem(record, now);
      if (problem !== null) return refuse(problem);
      if (!(await deps.store.touchInstall(record.codeId, payload.iid, now))) {
        return refuse('not_activated');
      }
      return issue(deps, record, payload.iid, now);
    });
  }

  return { activate, refresh };
}
