import { posix } from 'node:path';

import type { BlogConfig } from './config';
import { BlogTransformError } from './errors';
import { POST_FILE_NAME_PATTERN, SERIES_NAME } from './frontmatter';
import type { LoadedPost } from './load';
import { slugify } from './slugify';

// Turns a repo post into exactly the record the blog stores. Pure: the clock and the config come
// in through the context, and nothing here touches the file system or the environment, so the
// same inputs always give the same payload.

export interface PostTag {
  readonly name: string;
  readonly slug: string;
}

/** The blog's `Post` record plus its linked tags. */
export interface PostPayload {
  readonly title: string;
  readonly slug: string;
  /** Markdown that is also valid MDX: comments stripped, links and images made absolute. */
  readonly content: string;
  readonly excerpt: string;
  readonly published: boolean;
  readonly publishedAt: Date | null;
  readonly coverImage: string | null;
  readonly tags: readonly PostTag[];
}

export interface TransformContext {
  /** Every post in the series, so links between parts can be resolved to their slugs. */
  readonly allPosts: readonly LoadedPost[];
  readonly config: BlogConfig;
  /** Used as `publishedAt` when a `final` post has none yet. */
  readonly now: Date;
}

/** Posts live here; relative links are resolved against this repo folder. */
const BLOG_DIR = 'docs/blog';
/** Images must resolve inside this folder; it is what `assetBaseUrl` serves. */
const IMAGES_DIR = 'docs/blog/images';
const EXCERPT_MAX_LENGTH = 160;

/** Builds the blog payload for one post. Throws BlogTransformError for posts that can't be pushed. */
export function toPostPayload(post: LoadedPost, context: TransformContext): PostPayload {
  const { frontmatter } = post;
  if (frontmatter.status === 'planned' || frontmatter.status === 'outline') {
    throw new BlogTransformError(post.path, [
      `status is ${frontmatter.status}; only draft and final posts go to the blog`,
    ]);
  }

  const masked = maskMarkdown(post.body, post.path);
  const problems: string[] = [];
  const linkContext: LinkContext = { post, context, problems };
  const rewritten = rewriteReferenceDefinitions(
    rewriteInlineLinks(masked.text, linkContext),
    linkContext,
  );
  if (problems.length > 0) {
    throw new BlogTransformError(post.path, problems);
  }

  const excerpt = frontmatter.excerpt ?? excerptFromBody(masked);
  if (excerpt === '') {
    throw new BlogTransformError(post.path, [
      'no excerpt in the frontmatter and no paragraph in the body to build one from',
    ]);
  }

  const published = frontmatter.status === 'final';
  return {
    title: frontmatter.title,
    slug: frontmatter.slug,
    content: `${unmask(rewritten, masked.spans)}\n`,
    excerpt,
    published,
    publishedAt: resolvePublishedAt(frontmatter.publishedAt, published, context.now),
    coverImage: frontmatter.coverImage ?? null,
    tags: buildTags(frontmatter.tags),
  };
}

function resolvePublishedAt(
  publishedAt: string | undefined,
  published: boolean,
  now: Date,
): Date | null {
  if (publishedAt !== undefined) {
    return new Date(`${publishedAt}T00:00:00.000Z`);
  }
  return published ? new Date(now.getTime()) : null;
}

/** The post's tags plus the series tag, one per slug (the first name wins), sorted by slug. */
function buildTags(frontmatterTags: readonly string[]): PostTag[] {
  const tagsBySlug = new Map<string, PostTag>();
  for (const name of [SERIES_NAME, ...frontmatterTags]) {
    const slug = slugify(name);
    if (!tagsBySlug.has(slug)) {
      tagsBySlug.set(slug, { name, slug });
    }
  }
  return [...tagsBySlug.values()].sort((left, right) => compareStrings(left.slug, right.slug));
}

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

// ---------------------------------------------------------------------------------------------
// Masking: code is copied through untouched, comments are dropped.
//
// Fenced code blocks and inline code spans are swapped for placeholders before any rewriting, so
// a link written inside code stays exactly as written. HTML comments outside code are removed,
// because MDX rejects them.
// ---------------------------------------------------------------------------------------------

// A private-use character marks placeholders; a post body never needs one.
const PLACEHOLDER_MARK = '\uE000';
const PLACEHOLDER_PATTERN = /\uE000(\d+)\uE000/g;

interface MaskedSpan {
  readonly source: string;
  readonly isFence: boolean;
}

interface MaskedMarkdown {
  /** The body with code replaced by placeholders and comments removed. */
  readonly text: string;
  readonly spans: readonly MaskedSpan[];
}

function placeholder(index: number): string {
  return `${PLACEHOLDER_MARK}${String(index)}${PLACEHOLDER_MARK}`;
}

function maskMarkdown(body: string, filePath: string): MaskedMarkdown {
  if (body.includes(PLACEHOLDER_MARK)) {
    throw new BlogTransformError(filePath, ['the body contains the private-use character U+E000']);
  }
  const spans: MaskedSpan[] = [];
  let text = '';
  let position = 0;

  while (position < body.length) {
    const atLineStart = position === 0 || body[position - 1] === '\n';
    if (atLineStart) {
      const fenceEnd = findFencedBlockEnd(body, position);
      if (fenceEnd !== null) {
        text += placeholder(spans.length);
        spans.push({ source: body.slice(position, fenceEnd), isFence: true });
        position = fenceEnd;
        continue;
      }
    }

    if (body.startsWith('<!--', position)) {
      const closeIndex = body.indexOf('-->', position + 4);
      if (closeIndex === -1) {
        throw new BlogTransformError(filePath, [
          `the HTML comment on body line ${String(lineNumberAt(body, position))} is never closed`,
        ]);
      }
      position = closeIndex + 3;
      continue;
    }

    const character = body.charAt(position);
    if (character === '`') {
      const runLength = countRun(body, position, '`');
      const closeIndex = findClosingBacktickRun(body, position + runLength, runLength);
      if (closeIndex === null) {
        text += body.slice(position, position + runLength);
        position += runLength;
      } else {
        text += placeholder(spans.length);
        spans.push({ source: body.slice(position, closeIndex + runLength), isFence: false });
        position = closeIndex + runLength;
      }
      continue;
    }

    if (character === '\\' && position + 1 < body.length) {
      // Keep escapes as a pair so an escaped backtick or bracket is never treated as syntax.
      text += body.slice(position, position + 2);
      position += 2;
      continue;
    }

    text += character;
    position += 1;
  }

  return { text: tidyBlankLines(text), spans };
}

/** If a fenced code block opens at `lineStart`, returns the index just past its closing line. */
function findFencedBlockEnd(body: string, lineStart: number): number | null {
  const openingLine = readLine(body, lineStart);
  const opening = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(openingLine.text);
  const fence = opening?.[1];
  if (fence === undefined || (fence.startsWith('`') && opening?.[2]?.includes('`') === true)) {
    return null;
  }
  const fenceCharacter = fence.charAt(0);
  const closingPattern = new RegExp(
    `^[ \\t]*\\${fenceCharacter}{${String(fence.length)},}[ \\t]*$`,
  );

  let lineEnd = openingLine.end;
  while (lineEnd < body.length) {
    const line = readLine(body, lineEnd + 1);
    if (closingPattern.test(line.text)) {
      return line.end;
    }
    lineEnd = line.end;
  }
  // An unclosed fence runs to the end of the document, as in CommonMark.
  return body.length;
}

/** The line starting at `start`, and the index of its newline (or the end of the text). */
function readLine(body: string, start: number): { text: string; end: number } {
  const newlineIndex = body.indexOf('\n', start);
  const end = newlineIndex === -1 ? body.length : newlineIndex;
  return { text: body.slice(start, end).replace(/\r$/, ''), end };
}

function countRun(body: string, start: number, character: string): number {
  let length = 0;
  while (body.charAt(start + length) === character) {
    length += 1;
  }
  return length;
}

/** Finds a backtick run of exactly `runLength` before the paragraph ends, or null. */
function findClosingBacktickRun(body: string, start: number, runLength: number): number | null {
  const paragraphEnd = body.slice(start).search(/\n[ \t]*\n/);
  const limit = paragraphEnd === -1 ? body.length : start + paragraphEnd;
  let position = start;
  while (position < limit) {
    if (body.charAt(position) === '`') {
      const length = countRun(body, position, '`');
      if (length === runLength) {
        return position;
      }
      position += length;
    } else {
      position += 1;
    }
  }
  return null;
}

function lineNumberAt(body: string, index: number): number {
  return body.slice(0, index).split('\n').length;
}

/** Removes the blank lines a stripped comment leaves behind, and trims the ends. */
function tidyBlankLines(text: string): string {
  return text
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function unmask(text: string, spans: readonly MaskedSpan[]): string {
  return text.replace(PLACEHOLDER_PATTERN, (_match, index: string) => {
    return spans[Number(index)]?.source ?? '';
  });
}

// ---------------------------------------------------------------------------------------------
// Link and image rewriting.
// ---------------------------------------------------------------------------------------------

interface LinkContext {
  readonly post: LoadedPost;
  readonly context: TransformContext;
  readonly problems: string[];
}

type LinkKind = 'link' | 'image';

/**
 * `[text](destination "title")` and `![alt](destination "title")`. The text may hold one level of
 * nested brackets, which covers an image inside a link. Groups: 1 `!` or empty, 2 text,
 * 3 space before the destination, 4 destination, 5 optional title and trailing space.
 */
const INLINE_LINK_PATTERN =
  /(!?)\[((?:[^[\]\\]|\\.|\[(?:[^[\]\\]|\\.)*\])*)\]\(([ \t]*)(<[^<>\n]*>|[^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)((?:[ \t\n]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t]*)\)/g;

/** `[label]: destination` reference definitions. Groups: 1 everything before the destination, 2 destination. */
const REFERENCE_DEFINITION_PATTERN = /^([ \t]{0,3}\[(?:[^[\]\\]|\\.)+\]:[ \t]*)(<[^<>\n]*>|\S+)/gm;

function rewriteInlineLinks(text: string, linkContext: LinkContext): string {
  let output = '';
  let lastIndex = 0;
  for (const match of text.matchAll(INLINE_LINK_PATTERN)) {
    const [whole, bang = '', linkText = '', leadingSpace = '', destination = '', titlePart = ''] =
      match;
    const kind: LinkKind = bang === '!' ? 'image' : 'link';
    const rewrittenText = rewriteInlineLinks(linkText, linkContext);
    const rewrittenDestination = rewriteDestination(destination, kind, linkContext);
    output += text.slice(lastIndex, match.index);
    output += `${bang}[${rewrittenText}](${leadingSpace}${rewrittenDestination}${titlePart})`;
    lastIndex = match.index + whole.length;
  }
  return output + text.slice(lastIndex);
}

function rewriteReferenceDefinitions(text: string, linkContext: LinkContext): string {
  let output = '';
  let lastIndex = 0;
  for (const match of text.matchAll(REFERENCE_DEFINITION_PATTERN)) {
    const [whole, prefix = '', destination = ''] = match;
    output += text.slice(lastIndex, match.index);
    output += prefix + rewriteDestination(destination, 'link', linkContext);
    lastIndex = match.index + whole.length;
  }
  return output + text.slice(lastIndex);
}

/**
 * Makes one destination work on the blog:
 * - absolute URLs, site paths (`/x`) and same-page anchors (`#x`) are left alone;
 * - anything resolving inside docs/blog/images is served from `assetBaseUrl`;
 * - a sibling post (`NN-x.md`) becomes `/blog/<its slug>`, keeping any `#anchor`;
 * - any other repo file becomes a link to it on the repo host.
 * Images must resolve inside docs/blog/images; anything else is recorded as a problem.
 */
function rewriteDestination(
  rawDestination: string,
  kind: LinkKind,
  linkContext: LinkContext,
): string {
  const isAngled = rawDestination.startsWith('<') && rawDestination.endsWith('>');
  const destination = isAngled ? rawDestination.slice(1, -1) : rawDestination;
  if (destination === '' || !isRepoRelative(destination)) {
    return rawDestination;
  }

  const suffixIndex = destination.search(/[?#]/);
  const pathPart = suffixIndex === -1 ? destination : destination.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? '' : destination.slice(suffixIndex);
  if (pathPart === '') {
    return rawDestination;
  }

  const { problems } = linkContext;
  const { config, allPosts } = linkContext.context;
  const repoPath = posix.normalize(posix.join(BLOG_DIR, pathPart));
  if (repoPath === '..' || repoPath.startsWith('../')) {
    problems.push(`${kind} "${destination}" points outside the repository`);
    return rawDestination;
  }

  let rewritten: string;
  if (repoPath.startsWith(`${IMAGES_DIR}/`)) {
    rewritten = `${config.assetBaseUrl}/${repoPath.slice(IMAGES_DIR.length + 1)}${suffix}`;
  } else if (kind === 'image') {
    problems.push(
      `image "${destination}" resolves to ${repoPath}, which is outside ${IMAGES_DIR}/`,
    );
    return rawDestination;
  } else if (
    posix.dirname(repoPath) === BLOG_DIR &&
    POST_FILE_NAME_PATTERN.test(posix.basename(repoPath))
  ) {
    const targetFileName = posix.basename(repoPath);
    const target = allPosts.find((candidate) => candidate.fileName === targetFileName);
    if (target === undefined) {
      problems.push(
        `link "${destination}" points at ${targetFileName}, which is not a loaded post`,
      );
      return rawDestination;
    }
    rewritten = `/blog/${target.frontmatter.slug}${suffix}`;
  } else {
    rewritten = `${config.repoUrl}/blob/${config.repoBranch}/${repoPath}${suffix}`;
  }
  return isAngled ? `<${rewritten}>` : rewritten;
}

function isRepoRelative(destination: string): boolean {
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(destination);
  return !hasScheme && !destination.startsWith('/') && !destination.startsWith('#');
}

// ---------------------------------------------------------------------------------------------
// Excerpt fallback: the first paragraph of prose, as plain text, cut to 160 characters.
// ---------------------------------------------------------------------------------------------

function excerptFromBody(masked: MaskedMarkdown): string {
  for (const block of masked.text.split(/\n[ \t]*\n/)) {
    const trimmed = block.trim();
    if (trimmed === '' || /^(#|\||<|-{3,}\s*$|\*{3,}\s*$)/.test(trimmed)) {
      continue;
    }
    const plain = toPlainText(trimmed, masked.spans);
    if (plain !== '') {
      return truncateAtWord(plain, EXCERPT_MAX_LENGTH);
    }
  }
  return '';
}

function toPlainText(markdown: string, spans: readonly MaskedSpan[]): string {
  let text = markdown;
  // Images carry no prose; links keep their text. Repeat once for an image inside a link.
  for (let pass = 0; pass < 2; pass += 1) {
    text = text.replace(INLINE_LINK_PATTERN, (_match, bang: string, linkText: string) =>
      bang === '!' ? '' : linkText,
    );
  }
  text = text
    .replace(/\[([^[\]]*)\]\[[^[\]]*\]/g, '$1')
    .replace(/^[ \t]{0,3}(>[ \t]?)+/gm, '')
    .replace(/^[ \t]*([-*+]|\d+[.)])[ \t]+/gm, '');
  for (let pass = 0; pass < 2; pass += 1) {
    text = text.replace(/(\*\*|__|~~|\*|_)(?=\S)([\s\S]*?\S)\1/g, '$2');
  }
  text = text.replace(PLACEHOLDER_PATTERN, (_match, index: string) => {
    const span = spans[Number(index)];
    if (span === undefined || span.isFence) {
      return '';
    }
    return span.source.replace(/^`+ ?/, '').replace(/ ?`+$/, '');
  });
  return text
    .replace(/\\([\\`*_{}[\]()#+\-.!<>~|])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cuts `text` at a word boundary so that, with the ellipsis, it is at most `maxLength` long. */
function truncateAtWord(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const head = text.slice(0, maxLength);
  const lastSpace = head.lastIndexOf(' ');
  const cut = lastSpace > 0 ? head.slice(0, lastSpace) : text.slice(0, maxLength - 1);
  return `${cut.replace(/[\s,;:.!?-]+$/, '')}…`;
}
