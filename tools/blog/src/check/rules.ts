import { posix } from 'node:path';

import { compileSync } from '@mdx-js/mdx';
import GithubSlugger from 'github-slugger';
import remarkGfm from 'remark-gfm';

import { readBlogConfig } from '../config';
import { BlogTransformError } from '../errors';
import { POST_FILE_NAME_PATTERN, PostFrontmatter } from '../frontmatter';
import type { LoadedPost } from '../load';
import { INLINE_LINK_PATTERN, REFERENCE_DEFINITION_PATTERN, toPostPayload } from '../transform';
import { bannedTermPattern, maskTerm } from './mask';
import { blankOut, bodyText, frontmatterKeyLine, lineAt, readTableAfterHeading } from './markdown';
import type { BannedTerm, BannedTerms, CheckIssue, RuleId, Severity, SourceFile } from './types';
import { SETUP_FILE } from './types';

// The blog rules, one exported function per rule. Each takes the context it needs and returns
// its issues; none of them reads the file system or the environment directly.

/** A file in docs/blog that is (or is meant to be) a post. */
export interface PostEntry {
  readonly source: SourceFile;
  /** The validated frontmatter, or null when it is missing or invalid. */
  readonly frontmatter: PostFrontmatter | null;
  /** The post in the shape the publish transform takes, or null when the frontmatter is invalid. */
  readonly loaded: LoadedPost | null;
}

/** Context for the rules that check one post. */
export interface PostRuleContext {
  readonly post: PostEntry;
  /** Every post file in docs/blog, this one included. */
  readonly allPosts: readonly PostEntry[];
  /** Whether a repo-relative path names an existing file or folder. */
  readonly fileExists: (repoPath: string) => boolean;
}

/** Context for the public content rules, which run on every blog and journal file. */
export interface ContentRuleContext {
  readonly source: SourceFile;
  readonly bannedTerms: BannedTerms;
}

/** Context for the series index rule, which looks at the whole blog folder at once. */
export interface SeriesIndexContext {
  /** docs/blog/README.md, or null when it does not exist. */
  readonly readme: SourceFile | null;
  readonly posts: readonly PostEntry[];
}

export const BLOG_README_PATH = 'docs/blog/README.md';
const SERIES_INDEX_HEADING = 'Series index';
const EXCERPT_MIN_LENGTH = 50;
const EXCERPT_MAX_LENGTH = 200;

/** A fixed clock for the transform; `publishedAt` never affects whether a post compiles. */
const CHECK_CLOCK = new Date('2000-01-01T00:00:00.000Z');

export function makeIssue(
  rule: RuleId,
  severity: Severity,
  file: string,
  line: number | null,
  message: string,
): CheckIssue {
  return line === null
    ? { rule, severity, file, message }
    : { rule, severity, file, line, message };
}

function fileNameOf(source: SourceFile): string {
  return posix.basename(source.path);
}

// ---------------------------------------------------------------------------------------------
// frontmatter-valid
// ---------------------------------------------------------------------------------------------

/** Reports a missing or unparseable frontmatter block and every schema problem, with its path. */
export function frontmatterValid(context: PostRuleContext): CheckIssue[] {
  const { source } = context.post;
  if (source.frontmatterProblem !== null) {
    return [
      makeIssue(
        'frontmatter-valid',
        'error',
        source.path,
        source.frontmatterProblem.line,
        source.frontmatterProblem.message,
      ),
    ];
  }
  return schemaIssues(source, 'frontmatter-valid', validatePostFrontmatter(source.frontmatterData));
}

/** Validates post frontmatter, returning either the data or `{ path, message }` issues. */
export function validatePostFrontmatter(
  data: unknown,
):
  | { readonly ok: true; readonly frontmatter: PostFrontmatter }
  | { readonly ok: false; readonly issues: readonly SchemaIssue[] } {
  const parsed = PostFrontmatter.safeParse(data);
  if (parsed.success) {
    return { ok: true, frontmatter: parsed.data };
  }
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.map((segment) => String(segment)),
      message: issue.message,
    })),
  };
}

/** One schema problem: the path of the offending field and zod's message. */
export interface SchemaIssue {
  readonly path: readonly string[];
  readonly message: string;
}

/** Turns schema problems into issues pointing at the line of each field's top-level key. */
export function schemaIssues(
  source: SourceFile,
  rule: RuleId,
  result: { readonly ok: true } | { readonly ok: false; readonly issues: readonly SchemaIssue[] },
): CheckIssue[] {
  if (result.ok) {
    return [];
  }
  return result.issues.map((issue) => {
    const key = issue.path[0];
    const line = key === undefined ? 1 : (frontmatterKeyLine(source, key) ?? 1);
    const fieldPath = issue.path.join('.');
    const message = fieldPath === '' ? issue.message : `${fieldPath}: ${issue.message}`;
    return makeIssue(rule, 'error', source.path, line, message);
  });
}

// ---------------------------------------------------------------------------------------------
// file-name-matches-part
// ---------------------------------------------------------------------------------------------

/** `NN` in the file name equals `part`, and no other post shares this post's part or slug. */
export function fileNameMatchesPart(context: PostRuleContext): CheckIssue[] {
  const { source, frontmatter } = context.post;
  const fileName = fileNameOf(source);
  if (!POST_FILE_NAME_PATTERN.test(fileName)) {
    return [
      makeIssue(
        'file-name-matches-part',
        'error',
        source.path,
        null,
        'post files are named NN-<kebab-title>.md (two digits, then lowercase letters, digits and hyphens)',
      ),
    ];
  }
  if (frontmatter === null) {
    return [];
  }

  const issues: CheckIssue[] = [];
  const partFromName = Number(fileName.slice(0, 2));
  if (partFromName !== frontmatter.part) {
    issues.push(
      makeIssue(
        'file-name-matches-part',
        'error',
        source.path,
        frontmatterKeyLine(source, 'part'),
        `part is ${String(frontmatter.part)} but the file name starts with ${fileName.slice(0, 2)}`,
      ),
    );
  }
  for (const other of context.allPosts) {
    if (other.source.path === source.path || other.frontmatter === null) {
      continue;
    }
    if (other.frontmatter.part === frontmatter.part) {
      issues.push(
        makeIssue(
          'file-name-matches-part',
          'error',
          source.path,
          frontmatterKeyLine(source, 'part'),
          `part ${String(frontmatter.part)} is also used by ${other.source.path}`,
        ),
      );
    }
    if (other.frontmatter.slug === frontmatter.slug) {
      issues.push(
        makeIssue(
          'file-name-matches-part',
          'error',
          source.path,
          frontmatterKeyLine(source, 'slug'),
          `slug ${frontmatter.slug} is also used by ${other.source.path}`,
        ),
      );
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------------------------
// mdx-compiles
// ---------------------------------------------------------------------------------------------

/** The parts of an MDX syntax tree node this rule reads. */
interface MdxTreeNode {
  readonly type: string;
  readonly name?: string | null;
  readonly children?: readonly MdxTreeNode[];
  readonly attributes?: readonly MdxTreeAttribute[];
  readonly position?: { readonly start: { readonly line: number } };
}

interface MdxTreeAttribute {
  readonly type: string;
  readonly value?: unknown;
}

/** MDX syntax that compiles but fails or misbehaves when the blog renders the post. */
interface RenderHazard {
  readonly line: number;
  readonly message: string;
}

const EXPRESSION_HINT =
  'MDX reads { and } as a JavaScript expression, which fails when the blog renders the post; put it in backticks or write \\{';
const COMPONENT_HINT =
  'MDX reads a < before a capital letter as a component the blog does not have; put it in backticks or write &lt;';
const ESM_HINT =
  'MDX reads a line starting with import or export as JavaScript; reword it or put it in backticks';

/**
 * Builds the blog payload exactly as the publisher would, with the documented default config,
 * and compiles it with the blog's MDX compiler and plugins. Reports the compile error, mapped back
 * to the line in the repo file, and any expressions, components or import/export lines that
 * compile but would break the rendered page. Runs only for `draft` and `final` posts.
 */
export function mdxCompiles(context: PostRuleContext): CheckIssue[] {
  const { source, frontmatter, loaded } = context.post;
  if (frontmatter === null || loaded === null) {
    return [];
  }
  if (frontmatter.status !== 'draft' && frontmatter.status !== 'final') {
    return [];
  }

  let content: string;
  try {
    const allLoaded = context.allPosts.flatMap((entry) =>
      entry.loaded === null ? [] : [entry.loaded],
    );
    content = toPostPayload(loaded, {
      allPosts: allLoaded,
      config: readBlogConfig({}),
      now: CHECK_CLOCK,
    }).content;
  } catch (error: unknown) {
    if (error instanceof BlogTransformError) {
      return error.problems.map((problem) =>
        makeIssue(
          'mdx-compiles',
          'error',
          source.path,
          null,
          `cannot build the blog payload: ${problem}`,
        ),
      );
    }
    throw error;
  }

  const hazards: RenderHazard[] = [];
  const collectHazards = () => (tree: MdxTreeNode) => {
    findRenderHazards(tree, hazards);
  };
  try {
    compileSync(content, { remarkPlugins: [remarkGfm, collectHazards] });
  } catch (error: unknown) {
    const location = compileErrorLocation(error);
    const contentLine = location.line ?? 1;
    return [
      makeIssue(
        'mdx-compiles',
        'error',
        source.path,
        mapContentLineToFile(content, source, contentLine),
        `MDX cannot compile the post: ${location.reason}${compileHint(location.reason)}`,
      ),
    ];
  }
  return hazards.map((hazard) =>
    makeIssue(
      'mdx-compiles',
      'error',
      source.path,
      mapContentLineToFile(content, source, hazard.line),
      hazard.message,
    ),
  );
}

function findRenderHazards(node: MdxTreeNode, hazards: RenderHazard[]): void {
  const line = node.position?.start.line ?? 1;
  switch (node.type) {
    case 'mdxFlowExpression':
    case 'mdxTextExpression':
      hazards.push({ line, message: EXPRESSION_HINT });
      break;
    case 'mdxjsEsm':
      hazards.push({ line, message: ESM_HINT });
      break;
    case 'mdxJsxFlowElement':
    case 'mdxJsxTextElement': {
      const name = node.name ?? '';
      if (/^[A-Z]/.test(name) || name.includes('.')) {
        hazards.push({ line, message: `<${name}> is not an HTML tag. ${COMPONENT_HINT}` });
      }
      const hasExpression = (node.attributes ?? []).some(
        (attribute) =>
          attribute.type === 'mdxJsxExpressionAttribute' ||
          isAttributeValueExpression(attribute.value),
      );
      if (hasExpression) {
        hazards.push({ line, message: EXPRESSION_HINT });
      }
      break;
    }
    default:
      break;
  }
  for (const child of node.children ?? []) {
    findRenderHazards(child, hazards);
  }
}

function isAttributeValueExpression(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'mdxJsxAttributeValueExpression'
  );
}

/** Reads the reason and the most precise line out of an MDX compile error. */
function compileErrorLocation(error: unknown): { reason: string; line: number | null } {
  if (!(error instanceof Error)) {
    return { reason: String(error), line: null };
  }
  const reasonValue = 'reason' in error ? error.reason : undefined;
  const reason = typeof reasonValue === 'string' ? reasonValue : error.message;
  const lineValue = 'line' in error ? error.line : undefined;
  // Messages such as "Expected a closing tag for `<T>` (3:16-3:19) before the end of
  // `paragraph`" name the exact spot, while `line` is where the paragraph starts.
  const spot = /\((\d+):\d+-\d+:\d+\)/.exec(reason);
  const spotLine = spot?.[1] === undefined ? null : Number(spot[1]);
  return {
    // The positions in the message are payload positions, which mean nothing in the repo file.
    reason: reason.replace(/ \(\d+:\d+(?:-\d+:\d+)?\)/g, ''),
    line: spotLine ?? (typeof lineValue === 'number' ? lineValue : null),
  };
}

function compileHint(reason: string): string {
  if (/closing tag|tag name|before name|JSX|`<`/i.test(reason)) {
    return '. A < before a letter starts a JSX tag in MDX; put code like this in backticks or write &lt;';
  }
  if (/expression|brace|acorn/i.test(reason)) {
    return '. MDX reads { and } as JavaScript; put them in backticks or write \\{';
  }
  return '';
}

/** Link destinations and reference definitions differ between the payload and the file. */
function normalizeForAlignment(line: string): string {
  return line
    .replace(/\]\([^)]*\)/g, ']()')
    .replace(/^(\s*\[[^\]]+\]:)\s*\S+/, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Maps a 1-based line of the payload content back to its line in the repo file. The transform
 * drops comments and blank lines and rewrites link destinations, so the line numbers drift; this
 * walks both texts in step, matching each payload line to the next file line with the same text
 * once comments are blanked and destinations ignored.
 */
export function mapContentLineToFile(
  content: string,
  source: SourceFile,
  contentLine: number,
): number {
  const contentLines = content.split('\n');
  const fileLines = blankOut(source.text, { comments: true }).split('\n');
  let filePointer = source.frontmatterEndLine;
  let lastMatch: { contentIndex: number; fileIndex: number } | null = null;

  for (let index = 0; index < contentLine && index < contentLines.length; index += 1) {
    const normalized = normalizeForAlignment(contentLines[index] ?? '');
    if (normalized === '') {
      continue;
    }
    for (let search = filePointer; search < fileLines.length; search += 1) {
      if (normalizeForAlignment(fileLines[search] ?? '') === normalized) {
        lastMatch = { contentIndex: index, fileIndex: search };
        filePointer = search + 1;
        break;
      }
    }
  }
  if (lastMatch === null) {
    return source.frontmatterEndLine + contentLine;
  }
  return lastMatch.fileIndex + 1 + (contentLine - 1 - lastMatch.contentIndex);
}

// ---------------------------------------------------------------------------------------------
// no-body-h1
// ---------------------------------------------------------------------------------------------

/** The blog renders `title` as the page's H1, so the body may not have one. */
export function noBodyH1(context: PostRuleContext): CheckIssue[] {
  const { source } = context.post;
  const lines = blankOut(bodyText(source), { fences: true, comments: true }).split('\n');
  const issues: CheckIssue[] = [];
  lines.forEach((line, index) => {
    if (line.startsWith('# ')) {
      issues.push(
        makeIssue(
          'no-body-h1',
          'error',
          source.path,
          index + 1,
          'the blog renders the title as the H1; start sections at ##',
        ),
      );
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------------------------
// banned-terms and banned-terms-missing
// ---------------------------------------------------------------------------------------------

/**
 * Finds every term from the committed real-name blocklist and the private list anywhere in the
 * file: frontmatter, body, code, comments and alt text alike, and in the file's path. Terms are
 * always printed masked.
 */
export function bannedTerms(context: ContentRuleContext): CheckIssue[] {
  const { source } = context;
  const lists: { readonly terms: readonly BannedTerm[]; readonly label: string }[] = [
    { terms: context.bannedTerms.realNames, label: 'the real-name blocklist' },
    { terms: context.bannedTerms.privateTerms ?? [], label: 'the private banned-terms list' },
  ];
  const issues: CheckIssue[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const term of list.terms) {
      const masked = maskTerm(term.name);
      if (bannedTermPattern(term).test(source.path)) {
        issues.push(
          makeIssue(
            'banned-terms',
            'error',
            source.path,
            null,
            `the file path contains "${masked}" from ${list.label}`,
          ),
        );
      }
      for (const match of source.text.matchAll(bannedTermPattern(term))) {
        const line = lineAt(source.text, match.index);
        const key = `${masked}:${String(line)}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        issues.push(
          makeIssue(
            'banned-terms',
            'error',
            source.path,
            line,
            `"${masked}" is on ${list.label}; this repo is public`,
          ),
        );
      }
    }
  }
  return issues;
}

export const DEFAULT_BANNED_TERMS_FILE_HINT = '~/.config/ringside-booker/banned-terms.txt';

/** The private list could not be found: a warning normally, an error before publishing. */
export function bannedTermsMissing(
  bannedTermLists: BannedTerms,
  requireBannedTerms: boolean,
): CheckIssue[] {
  if (bannedTermLists.privateTerms !== null) {
    return [];
  }
  return [
    makeIssue(
      'banned-terms-missing',
      requireBannedTerms ? 'error' : 'warning',
      SETUP_FILE,
      null,
      `the private banned-terms list was not found or is empty, so only the real-name blocklist was checked. Set BLOG_BANNED_TERMS, point BLOG_BANNED_TERMS_FILE at the list, or create ${DEFAULT_BANNED_TERMS_FILE_HINT}`,
    ),
  ];
}

// ---------------------------------------------------------------------------------------------
// no-private-references
// ---------------------------------------------------------------------------------------------

/** Generic phrases only; anything more specific belongs in the private banned-terms list. */
const PRIVATE_REFERENCE_PATTERNS: readonly RegExp[] = [
  /research\s+notes?\s+\d+/gi,
  /reference\s+design/gi,
  /reference\s+study/gi,
];

/** No citing research notes, a reference design or a reference study, outside fenced code. */
export function noPrivateReferences(context: ContentRuleContext): CheckIssue[] {
  const { source } = context;
  const text = blankOut(source.text, { fences: true });
  const issues: CheckIssue[] = [];
  for (const pattern of PRIVATE_REFERENCE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const phrase = match[0].replace(/\s+/g, ' ').toLowerCase();
      issues.push(
        makeIssue(
          'no-private-references',
          'error',
          source.path,
          lineAt(text, match.index),
          `"${phrase}" points at private material; describe our own version in our own terms`,
        ),
      );
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------------------------
// no-todo-in-final
// ---------------------------------------------------------------------------------------------

const TODO_PATTERN = /\b(TODO|TBD|TK|XXX)\b/g;

/** Leftover markers outside code: an error in a `final` post, a warning in a `draft`. */
export function noTodoInFinal(context: PostRuleContext): CheckIssue[] {
  const { source, frontmatter } = context.post;
  if (frontmatter === null || (frontmatter.status !== 'final' && frontmatter.status !== 'draft')) {
    return [];
  }
  const severity: Severity = frontmatter.status === 'final' ? 'error' : 'warning';
  const text = blankOut(source.text, { fences: true, inlineCode: true });
  return [...text.matchAll(TODO_PATTERN)].map((match) =>
    makeIssue(
      'no-todo-in-final',
      severity,
      source.path,
      lineAt(text, match.index),
      `${match[0]} left in a ${frontmatter.status} post`,
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// links-resolve and images-have-alt
// ---------------------------------------------------------------------------------------------

/** A link or image found in a post body. */
export interface FoundLink {
  readonly kind: 'link' | 'image';
  /** The text between the brackets: link text, or alt text for an image. */
  readonly text: string;
  readonly destination: string;
  readonly line: number;
}

/** Every inline link, image and reference definition outside code and comments. */
export function findLinks(source: SourceFile): FoundLink[] {
  const text = blankOut(bodyText(source), { fences: true, inlineCode: true, comments: true });
  const links: FoundLink[] = [];
  collectInlineLinks(text, text, 0, links);
  for (const match of text.matchAll(REFERENCE_DEFINITION_PATTERN)) {
    links.push({
      kind: 'link',
      text: '',
      destination: match[2] ?? '',
      line: lineAt(text, match.index),
    });
  }
  return links;
}

function collectInlineLinks(
  fullText: string,
  text: string,
  offset: number,
  links: FoundLink[],
): void {
  for (const match of text.matchAll(INLINE_LINK_PATTERN)) {
    const bang = match[1] ?? '';
    const linkText = match[2] ?? '';
    const index = offset + match.index;
    links.push({
      kind: bang === '!' ? 'image' : 'link',
      text: linkText,
      destination: match[4] ?? '',
      line: lineAt(fullText, index),
    });
    collectInlineLinks(fullText, linkText, index + bang.length + 1, links);
  }
}

/** The anchors rehype-slug gives a post's headings on the blog, in order. */
export function headingSlugs(source: SourceFile): string[] {
  const slugger = new GithubSlugger();
  const lines = blankOut(bodyText(source), { fences: true, comments: true }).split('\n');
  const slugs: string[] = [];
  for (const line of lines) {
    const heading = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (heading?.[1] !== undefined) {
      slugs.push(slugger.slug(headingPlainText(heading[1])));
    }
  }
  return slugs;
}

/** Heading Markdown as the rendered text rehype-slug sees: links keep their text, marks go. */
function headingPlainText(markdown: string): string {
  let text = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  for (let pass = 0; pass < 2; pass += 1) {
    text = text.replace(/(\*\*|__|~~|\*|_)(?=\S)([\s\S]*?\S)\1/g, '$2');
  }
  return text.replace(/`/g, '').replace(/\\([\\`*_{}[\]()#+\-.!<>~|])/g, '$1');
}

/**
 * Every relative link and image resolves to a file in the repo, and an anchor into a post (this
 * one or a sibling) matches one of that post's headings.
 */
export function linksResolve(context: PostRuleContext): CheckIssue[] {
  const { source } = context.post;
  const issues: CheckIssue[] = [];
  const report = (line: number, message: string): void => {
    issues.push(makeIssue('links-resolve', 'error', source.path, line, message));
  };

  for (const link of findLinks(source)) {
    const destination = link.destination.replace(/^<(.*)>$/, '$1');
    if (destination === '') {
      report(link.line, `${link.kind} has an empty destination`);
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(destination) || destination.startsWith('/')) {
      continue;
    }
    const suffixIndex = destination.search(/[?#]/);
    const pathPart = suffixIndex === -1 ? destination : destination.slice(0, suffixIndex);
    const hashIndex = destination.indexOf('#');
    const anchor = hashIndex === -1 ? '' : destination.slice(hashIndex + 1);

    let targetPath = source.path;
    if (pathPart !== '') {
      const repoPath = posix.normalize(
        posix.join(posix.dirname(source.path), decodePath(pathPart)),
      );
      if (repoPath === '..' || repoPath.startsWith('../')) {
        report(link.line, `${link.kind} "${destination}" points outside the repository`);
        continue;
      }
      if (!context.fileExists(repoPath)) {
        report(
          link.line,
          `${link.kind} "${destination}" points at ${repoPath}, which does not exist`,
        );
        continue;
      }
      targetPath = repoPath;
    }

    if (anchor === '') {
      continue;
    }
    const target = context.allPosts.find((entry) => entry.source.path === targetPath);
    if (target === undefined) {
      continue;
    }
    if (!headingSlugs(target.source).includes(decodePath(anchor))) {
      report(
        link.line,
        `${link.kind} "${destination}": ${targetPath} has no heading with the anchor #${anchor}`,
      );
    }
  }
  return issues;
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Every image needs alt text: an error in a `final` post, a warning in a `draft`. */
export function imagesHaveAlt(context: PostRuleContext): CheckIssue[] {
  const { source, frontmatter } = context.post;
  if (frontmatter === null || (frontmatter.status !== 'final' && frontmatter.status !== 'draft')) {
    return [];
  }
  const severity: Severity = frontmatter.status === 'final' ? 'error' : 'warning';
  return findLinks(source)
    .filter((link) => link.kind === 'image' && link.text.trim() === '')
    .map((link) =>
      makeIssue(
        'images-have-alt',
        severity,
        source.path,
        link.line,
        `image "${link.destination}" has no alt text; describe what it shows`,
      ),
    );
}

// ---------------------------------------------------------------------------------------------
// series-index-sync
// ---------------------------------------------------------------------------------------------

/**
 * Every post file has a row in the README's series index with the same part, title and status,
 * and every index row that is not `planned` has a file.
 */
export function seriesIndexSync(context: SeriesIndexContext): CheckIssue[] {
  const { readme } = context;
  if (readme === null) {
    return [
      makeIssue('series-index-sync', 'error', BLOG_README_PATH, null, 'the blog README is missing'),
    ];
  }
  const rows = readTableAfterHeading(readme.text, SERIES_INDEX_HEADING);
  if (rows === null) {
    return [
      makeIssue(
        'series-index-sync',
        'error',
        readme.path,
        null,
        `no table under "## ${SERIES_INDEX_HEADING}"`,
      ),
    ];
  }

  const issues: CheckIssue[] = [];
  const rowsByPart = new Map<number, { line: number; title: string; status: string }>();
  for (const row of rows) {
    const [partCell = '', title = '', status = ''] = row.cells;
    if (!/^\d+$/.test(partCell)) {
      issues.push(
        makeIssue(
          'series-index-sync',
          'error',
          readme.path,
          row.line,
          `"${partCell}" is not a part number`,
        ),
      );
      continue;
    }
    const part = Number(partCell);
    if (rowsByPart.has(part)) {
      issues.push(
        makeIssue(
          'series-index-sync',
          'error',
          readme.path,
          row.line,
          `part ${partCell} has more than one row`,
        ),
      );
      continue;
    }
    rowsByPart.set(part, { line: row.line, title, status });
  }

  const partsWithFiles = new Set<number>();
  for (const post of context.posts) {
    const fileName = fileNameOf(post.source);
    if (!POST_FILE_NAME_PATTERN.test(fileName)) {
      continue;
    }
    const part = post.frontmatter?.part ?? Number(fileName.slice(0, 2));
    partsWithFiles.add(part);
    const row = rowsByPart.get(part);
    if (row === undefined) {
      issues.push(
        makeIssue(
          'series-index-sync',
          'error',
          post.source.path,
          null,
          `part ${String(part)} has no row in the series index (${readme.path})`,
        ),
      );
      continue;
    }
    if (post.frontmatter === null) {
      continue;
    }
    const where = `${readme.path}:${String(row.line)}`;
    if (row.title !== post.frontmatter.title) {
      issues.push(
        makeIssue(
          'series-index-sync',
          'error',
          post.source.path,
          frontmatterKeyLine(post.source, 'title'),
          `the series index (${where}) has the title "${row.title}" but the file has "${post.frontmatter.title}"`,
        ),
      );
    }
    if (row.status !== post.frontmatter.status) {
      issues.push(
        makeIssue(
          'series-index-sync',
          'error',
          post.source.path,
          frontmatterKeyLine(post.source, 'status'),
          `the series index (${where}) has the status "${row.status}" but the file has "${post.frontmatter.status}"`,
        ),
      );
    }
  }

  for (const [part, row] of rowsByPart) {
    if (row.status !== 'planned' && !partsWithFiles.has(part)) {
      issues.push(
        makeIssue(
          'series-index-sync',
          'error',
          readme.path,
          row.line,
          `part ${String(part)} is "${row.status}" but there is no docs/blog/${String(part).padStart(2, '0')}-*.md file`,
        ),
      );
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------------------------
// excerpt-length
// ---------------------------------------------------------------------------------------------

/** The excerpt shows on the blog's post list; 50 to 200 characters reads well there. */
export function excerptLength(context: PostRuleContext): CheckIssue[] {
  const { source } = context.post;
  const data = source.frontmatterData;
  if (typeof data !== 'object' || data === null || !('excerpt' in data)) {
    return [];
  }
  const excerpt = data.excerpt;
  if (typeof excerpt !== 'string') {
    return [];
  }
  // Counted the way the frontmatter schema counts, in UTF-16 code units.
  const length = excerpt.trim().length;
  if (length >= EXCERPT_MIN_LENGTH && length <= EXCERPT_MAX_LENGTH) {
    return [];
  }
  return [
    makeIssue(
      'excerpt-length',
      'warning',
      source.path,
      frontmatterKeyLine(source, 'excerpt'),
      `the excerpt is ${String(length)} characters; keep it between ${String(EXCERPT_MIN_LENGTH)} and ${String(EXCERPT_MAX_LENGTH)}`,
    ),
  ];
}
