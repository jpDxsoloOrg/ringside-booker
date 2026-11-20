/**
 * The owner's tool for tester codes (POL9-12). It works straight on the codes table through the
 * `league-szn` AWS profile; there is no admin endpoint.
 *
 *   npm run codes -- create --label "Sam" [--channel alpha|beta] [--max 2] [--expires 2027-06-30]
 *   npm run codes -- list
 *   npm run codes -- revoke RB-XXXX-XXXX
 *   npm run codes -- reset RB-XXXX-XXXX     (forgets the computers, so it can be activated again)
 *   npm run codes -- delete RB-XXXX-XXXX    (removes the row; for throwaway test codes)
 *
 * AWS_PROFILE and AWS_REGION default to league-szn and us-east-1; ACCESS_TABLE overrides the table.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { parseArgs } from 'node:util';
import { codeIdOf, generateCode, isChannel, normaliseCode, type Channel } from '../src/codes.js';
import { CodeStore, type CodeRecord } from '../src/store.js';

process.env['AWS_PROFILE'] ??= 'league-szn';
const region = process.env['AWS_REGION'] ?? 'us-east-1';
const table = process.env['ACCESS_TABLE'] ?? 'ringside-booker-access-codes';

const USAGE = `Usage:
  codes create --label "Name" [--channel alpha|beta] [--max 2] [--expires YYYY-MM-DD]
  codes list
  codes revoke <code>
  codes reset <code>
  codes delete <code>`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** The end of the given day (UTC), in Unix seconds. */
export function endOfDay(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    fail(`--expires wants a date like 2027-06-30, not "${day}"`);
  const time = Date.parse(`${day}T23:59:59Z`);
  if (Number.isNaN(time)) fail(`--expires: "${day}" is not a date`);
  return Math.floor(time / 1000);
}

function day(seconds: number | undefined): string {
  return seconds === undefined ? '-' : new Date(seconds * 1000).toISOString().slice(0, 10);
}

function status(record: CodeRecord, now: number): string {
  if (record.revoked) return 'revoked';
  if (record.expires !== undefined && record.expires <= now) return 'expired';
  return 'active';
}

function codeArgument(value: string | undefined): string {
  const code = normaliseCode(value);
  if (code === null) fail(`"${value ?? ''}" is not a code (they look like RB-XXXX-XXXX).`);
  return code;
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      label: { type: 'string' },
      channel: { type: 'string', default: 'alpha' },
      max: { type: 'string', default: '2' },
      expires: { type: 'string' },
    },
  });
  const [command, argument] = positionals;
  const store = new CodeStore(
    DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    }),
    table,
  );
  const now = Math.floor(Date.now() / 1000);

  switch (command) {
    case 'create': {
      const label = values.label?.trim() ?? '';
      if (label === '') fail('create needs --label "Who it is for"');
      const channel: string = values.channel;
      if (!isChannel(channel)) fail('--channel is alpha or beta');
      const max = Number(values.max);
      if (!Number.isInteger(max) || max < 1 || max > 20) fail('--max is a whole number, 1 to 20');
      const expires = values.expires === undefined ? undefined : endOfDay(values.expires);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = generateCode();
        const record: CodeRecord = {
          codeId: codeIdOf(code),
          code,
          label,
          channel: channel satisfies Channel,
          maxActivations: max,
          installs: {},
          installCount: 0,
          revoked: false,
          created: now,
          ...(expires === undefined ? {} : { expires }),
        };
        if (await store.create(record)) {
          console.log(code);
          console.error(
            `Made an ${channel} code for ${label}: ${max === 1 ? 'one computer' : `up to ${String(max)} computers`}, ${expires === undefined ? 'no expiry' : `expires ${day(expires)}`}.`,
          );
          return;
        }
      }
      fail('Could not make a new code (five clashes in a row); try again.');
      break;
    }
    case 'list': {
      const rows = await store.list();
      if (rows.length === 0) {
        console.log('No codes yet.');
        return;
      }
      for (const record of rows) {
        console.log(
          [
            record.code,
            status(record, now).padEnd(7),
            record.channel.padEnd(5),
            `${String(record.installCount)}/${String(record.maxActivations)} computers`,
            `made ${day(record.created)}`,
            `expires ${day(record.expires)}`,
            record.label,
          ].join('  '),
        );
      }
      return;
    }
    case 'revoke':
    case 'reset':
    case 'delete': {
      const code = codeArgument(argument);
      const codeId = codeIdOf(code);
      if (command === 'delete') {
        await store.remove(codeId);
        console.log(`Deleted ${code}.`);
        return;
      }
      const done = command === 'revoke' ? await store.revoke(codeId) : await store.reset(codeId);
      if (!done) fail(`No such code: ${code}`);
      console.log(
        command === 'revoke'
          ? `Revoked ${code}. Its games stop at their next check (within a week online, or when the 30-day grace runs out).`
          : `Reset ${code}: it can be activated on new computers again.`,
      );
      return;
    }
    default:
      fail(USAGE);
  }
}

await main();
