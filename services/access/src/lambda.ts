import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  GetParameterCommand,
  ParameterNotFound,
  PutParameterCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { makeHandlers, type Keys } from './handlers.js';
import { CodeStore } from './store.js';
import { generateKeyPair, privateKeyFrom, publicKeyFrom } from './token.js';

/**
 * The Lambda entry points (serverless.yml). The signing key is read from SSM Parameter Store (a
 * SecureString) once per warm container and never logged or returned.
 */
function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

const ssm = new SSMClient({});
const documents = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

let keys: Promise<Keys> | undefined;

async function readParameter(name: string, decrypt: boolean): Promise<string> {
  const result = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: decrypt }));
  const value = result.Parameter?.Value;
  if (value === undefined) throw new Error(`parameter ${name} is empty`);
  return value;
}

function loadKeys(): Promise<Keys> {
  keys ??= (async () => ({
    privateKey: privateKeyFrom(await readParameter(env('SIGNING_KEY_PARAM'), true)),
    publicKey: publicKeyFrom(await readParameter(env('PUBLIC_KEY_PARAM'), false)),
  }))().catch((error: unknown) => {
    keys = undefined;
    throw error;
  });
  return keys;
}

const handlers = makeHandlers({
  store: new CodeStore(documents, env('CODES_TABLE')),
  keys: loadKeys,
  now: () => Math.floor(Date.now() / 1000),
});

export const activate = (event: APIGatewayProxyEventV2) => handlers.activate(event);
export const refresh = (event: APIGatewayProxyEventV2) => handlers.refresh(event);

/**
 * Run once after the first deploy (`npm run keygen`): makes the Ed25519 key pair inside AWS. The
 * private key goes straight into the SecureString; only the public key is returned, to be put into
 * the game. Running it again changes nothing and returns the same public key.
 */
export async function keygen(): Promise<{ publicKey: string; created: boolean }> {
  const publicName = env('PUBLIC_KEY_PARAM');
  try {
    return { publicKey: await readParameter(publicName, false), created: false };
  } catch (error) {
    if (!(error instanceof ParameterNotFound)) throw error;
  }
  const pair = generateKeyPair();
  await ssm.send(
    new PutParameterCommand({
      Name: env('SIGNING_KEY_PARAM'),
      Type: 'SecureString',
      Value: pair.privateKeyPkcs8,
      Overwrite: false,
      Description: 'Ringside Booker tester access: Ed25519 signing key (PKCS#8, base64)',
    }),
  );
  await ssm.send(
    new PutParameterCommand({
      Name: publicName,
      Type: 'String',
      Value: pair.publicKeyRaw,
      Overwrite: false,
      Description: 'Ringside Booker tester access: Ed25519 public key (raw, base64)',
    }),
  );
  return { publicKey: pair.publicKeyRaw, created: true };
}
