import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of a file under test/fixtures. */
export function fixturePath(relativePath: string): string {
  return fileURLToPath(new URL(`fixtures/${relativePath}`, import.meta.url));
}

/** Runs `action`, expects it to throw an instance of `errorClass`, and returns that error. */
export function catchError<ErrorType extends Error>(
  action: () => unknown,
  errorClass: abstract new (...args: never[]) => ErrorType,
): ErrorType {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof errorClass) {
      return error;
    }
    throw error;
  }
  throw new Error(`expected ${errorClass.name} to be thrown`);
}

/** Awaits `promise`, expects it to reject with an instance of `errorClass`, and returns that error. */
export async function catchAsyncError<ErrorType extends Error>(
  promise: Promise<unknown>,
  errorClass: abstract new (...args: never[]) => ErrorType,
): Promise<ErrorType> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof errorClass) {
      return error;
    }
    throw error;
  }
  throw new Error(`expected ${errorClass.name} to be thrown`);
}

/**
 * Copies the fixture repository at test/fixtures/repo into a fresh temporary folder and returns
 * its path, so a test can edit files without touching the committed fixtures.
 */
export async function copyFixtureRepo(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), 'blog-check-'));
  await cp(fixturePath('repo'), repoRoot, { recursive: true });
  return repoRoot;
}

/** Rewrites a file in a copied fixture repo. */
export async function editRepoFile(
  repoRoot: string,
  repoPath: string,
  edit: (text: string) => string,
): Promise<void> {
  const absolutePath = join(repoRoot, repoPath);
  await writeFile(absolutePath, edit(await readFile(absolutePath, 'utf8')));
}

/** Writes a new file into a copied fixture repo. */
export async function writeRepoFile(
  repoRoot: string,
  repoPath: string,
  text: string,
): Promise<void> {
  await writeFile(join(repoRoot, repoPath), text);
}

/** Removes a copied fixture repo. */
export async function removeRepo(repoRoot: string): Promise<void> {
  await rm(repoRoot, { recursive: true, force: true });
}

/** The 1-based line of the first line of `text` that contains `needle`. */
export function lineContaining(text: string, needle: string): number {
  const index = text.split('\n').findIndex((line) => line.includes(needle));
  if (index === -1) {
    throw new Error(`no line contains ${needle}`);
  }
  return index + 1;
}
