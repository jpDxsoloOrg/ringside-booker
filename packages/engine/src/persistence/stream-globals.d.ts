/**
 * The few web-platform globals the save codec uses, declared by hand.
 *
 * The engine compiles with no DOM and no Node types, so it cannot see the browser's or Node's
 * declarations. These are the minimal shapes the codec needs: a compression stream's writable and
 * readable sides with their writer and reader, and UTF-8 text encoding. All of them exist in
 * browsers, Web Workers and Node 20. Nothing here declares `Blob` or `Response` on purpose: the
 * codec uses the stream writer and reader only, so the surface stays this small.
 */

interface ReadableStreamReadDoneResult {
  readonly done: true;
  readonly value?: undefined;
}

interface ReadableStreamReadValueResult<T> {
  readonly done: false;
  readonly value: T;
}

type ReadableStreamReadResult<T> = ReadableStreamReadDoneResult | ReadableStreamReadValueResult<T>;

interface ReadableStreamDefaultReader<T> {
  read(): Promise<ReadableStreamReadResult<T>>;
  cancel(reason?: unknown): Promise<void>;
}

interface ReadableStream<T> {
  getReader(): ReadableStreamDefaultReader<T>;
}

interface WritableStreamDefaultWriter<T> {
  write(chunk: T): Promise<void>;
  close(): Promise<void>;
}

interface WritableStream<T> {
  getWriter(): WritableStreamDefaultWriter<T>;
}

type CompressionFormat = 'gzip' | 'deflate' | 'deflate-raw';

interface CompressionStream {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
}

declare const CompressionStream: {
  readonly prototype: CompressionStream;
  new (format: CompressionFormat): CompressionStream;
};

interface DecompressionStream {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
}

declare const DecompressionStream: {
  readonly prototype: DecompressionStream;
  new (format: CompressionFormat): DecompressionStream;
};

interface TextEncoder {
  encode(input?: string): Uint8Array;
}

declare const TextEncoder: {
  readonly prototype: TextEncoder;
  new (): TextEncoder;
};

interface TextDecoderOptions {
  readonly fatal?: boolean;
  readonly ignoreBOM?: boolean;
}

interface TextDecoder {
  decode(input?: Uint8Array): string;
}

declare const TextDecoder: {
  readonly prototype: TextDecoder;
  new (label?: string, options?: TextDecoderOptions): TextDecoder;
};
