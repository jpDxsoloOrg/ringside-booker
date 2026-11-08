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
