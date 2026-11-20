import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { Channel } from './codes.js';

/** One computer that activated a code: when it first did, and when it last checked back. */
export interface InstallRecord {
  first: number;
  last: number;
}

/** One row of the codes table (key `codeId`). Times are Unix seconds. */
export interface CodeRecord {
  codeId: string;
  code: string;
  /** Who it's for, e.g. "Sam". */
  label: string;
  channel: Channel;
  maxActivations: number;
  installs: Record<string, InstallRecord>;
  installCount: number;
  /** End of the code's last day, or absent for no expiry. */
  expires?: number;
  revoked: boolean;
  created: number;
  /** Per-code rate limit: the hour being counted and the calls in it. */
  rateWindow?: number;
  rateCount?: number;
}

/** Activate and refresh calls one code may make in an hour (all of its computers together). */
export const CALLS_PER_CODE_PER_HOUR = 20;

export type AddInstallResult = 'added' | 'already' | 'full';

function isConditionFailure(error: unknown): boolean {
  return (
    error instanceof ConditionalCheckFailedException ||
    (error instanceof Error && error.name === 'ConditionalCheckFailedException')
  );
}

export class CodeStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get(codeId: string): Promise<CodeRecord | undefined> {
    const result = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { codeId }, ConsistentRead: true }),
    );
    return result.Item as CodeRecord | undefined;
  }

  /**
   * Counts one call against the code's hourly allowance. False when the code has used it up (or
   * the row is gone).
   */
  async takeRateSlot(codeId: string, nowSeconds: number): Promise<boolean> {
    const window = Math.floor(nowSeconds / 3600) * 3600;
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { codeId },
          UpdateExpression: 'SET rateCount = rateCount + :one',
          ConditionExpression:
            'attribute_exists(codeId) AND rateWindow = :window AND rateCount < :max',
          ExpressionAttributeValues: {
            ':one': 1,
            ':window': window,
            ':max': CALLS_PER_CODE_PER_HOUR,
          },
        }),
      );
      return true;
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
    }
    try {
      // A new hour (or the first call ever): start counting again.
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { codeId },
          UpdateExpression: 'SET rateWindow = :window, rateCount = :one',
          ConditionExpression:
            'attribute_exists(codeId) AND (attribute_not_exists(rateWindow) OR rateWindow < :window)',
          ExpressionAttributeValues: { ':one': 1, ':window': window },
        }),
      );
      return true;
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
      return false;
    }
  }

  /**
   * Adds a computer to the code, or notes that it checked back. "full" when the code is already on
   * as many computers as it allows.
   */
  async addInstall(
    codeId: string,
    installId: string,
    nowSeconds: number,
    maxActivations: number,
  ): Promise<AddInstallResult> {
    if (await this.touchInstall(codeId, installId, nowSeconds)) return 'already';
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { codeId },
          UpdateExpression: 'SET installs.#iid = :install, installCount = installCount + :one',
          ConditionExpression:
            'attribute_exists(codeId) AND attribute_not_exists(installs.#iid) AND installCount < :max',
          ExpressionAttributeNames: { '#iid': installId },
          ExpressionAttributeValues: {
            ':install': { first: nowSeconds, last: nowSeconds },
            ':one': 1,
            ':max': maxActivations,
          },
        }),
      );
      return 'added';
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
      // Another call may have added this same computer a moment ago.
      return (await this.touchInstall(codeId, installId, nowSeconds)) ? 'already' : 'full';
    }
  }

  /** Notes that a computer checked back. False when it isn't on the code (any more). */
  async touchInstall(codeId: string, installId: string, nowSeconds: number): Promise<boolean> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { codeId },
          UpdateExpression: 'SET installs.#iid.#last = :now',
          ConditionExpression: 'attribute_exists(installs.#iid)',
          ExpressionAttributeNames: { '#iid': installId, '#last': 'last' },
          ExpressionAttributeValues: { ':now': nowSeconds },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }

  // Admin (tools/codes.ts).

  async create(record: CodeRecord): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: record,
          ConditionExpression: 'attribute_not_exists(codeId)',
        }),
      );
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }

  async list(): Promise<CodeRecord[]> {
    const rows: CodeRecord[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.client.send(
        new ScanCommand({ TableName: this.tableName, ExclusiveStartKey: start }),
      );
      rows.push(...((page.Items ?? []) as CodeRecord[]));
      start = page.LastEvaluatedKey;
    } while (start !== undefined);
    return rows.sort((left, right) => left.created - right.created);
  }

  async revoke(codeId: string): Promise<boolean> {
    return this.updateExisting(codeId, 'SET revoked = :yes', { ':yes': true });
  }

  /** Forgets every computer on the code, so the tester can activate it again. */
  async reset(codeId: string): Promise<boolean> {
    return this.updateExisting(codeId, 'SET installs = :none, installCount = :zero', {
      ':none': {},
      ':zero': 0,
    });
  }

  async remove(codeId: string): Promise<void> {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: { codeId } }));
  }

  private async updateExisting(
    codeId: string,
    expression: string,
    values: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { codeId },
          UpdateExpression: expression,
          ConditionExpression: 'attribute_exists(codeId)',
          ExpressionAttributeValues: values,
        }),
      );
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }
}
