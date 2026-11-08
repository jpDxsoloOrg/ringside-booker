import { readTableAfterHeading } from './check/markdown';
import { BlogTransformError } from './errors';
import type { LoadedPost } from './load';
import { SERIES_INDEX_SLUG, escapeMarkdownText } from './series';
import { buildTags, excerptFromMarkdown, rewriteForBlog } from './transform';
import type { PostPayload, TransformContext } from './transform';

// The series index post, built from docs/blog/README.md: the README's intro paragraph, then a
// list of the published parts with links and a "Coming up" list of the rest without links. Only
// the README above the `<!-- public-index-end -->` marker is read; everything below it is how
// the series is written and checked, which is for the repo, not the blog.

export const SERIES_INDEX_TITLE = 'Ringside Booker: the series';
export const PUBLIC_INDEX_END_MARKER = '<!-- public-index-end -->';
export const SERIES_README_PATH = 'docs/blog/README.md';

const SERIES_INDEX_HEADING = 'Series index';

/** What the index needs besides the posts: the config for link rewriting and the clock. */
export type IndexContext = Omit<TransformContext, 'allPosts'>;

/** One part as the index lists it. */
interface IndexEntry {
  readonly part: number;
  readonly title: string;
  /** Set when the part is `final`; only these are linked. */
  readonly published: LoadedPost | null;
}

/** Builds the index post. Throws BlogTransformError when the README isn't shaped as expected. */
export function buildIndexPayload(
  readme: string,
  allPosts: readonly LoadedPost[],
  context: IndexContext,
): PostPayload {
  const markerIndex = readme.indexOf(PUBLIC_INDEX_END_MARKER);
  if (markerIndex === -1) {
    throw new BlogTransformError(SERIES_README_PATH, [
      `no ${PUBLIC_INDEX_END_MARKER} marker; add it on its own line after the series index ` +
        'table and before the rules, so the index post knows where the public part ends',
    ]);
  }
  const publicPart = readme.slice(0, markerIndex);
  const transformContext: TransformContext = { ...context, allPosts };

  const intro = readIntroParagraph(publicPart);
  const introForBlog = rewriteForBlog(intro, SERIES_README_PATH, transformContext);
  const excerpt = excerptFromMarkdown(intro, SERIES_README_PATH);

  const entries = readEntries(publicPart, allPosts);
  const published = entries.filter(isPublished);
  const comingUp = entries.filter((entry) => entry.published === null);

  const sections = [introForBlog];
  if (published.length > 0) {
    sections.push('## Published parts', published.map(publishedItem).join('\n\n'));
  }
  if (comingUp.length > 0) {
    sections.push('## Coming up', comingUp.map(comingUpItem).join('\n'));
  }

  return {
    title: SERIES_INDEX_TITLE,
    slug: SERIES_INDEX_SLUG,
    content: `${sections.join('\n\n')}\n`,
    excerpt,
    published: true,
    publishedAt: new Date(context.now.getTime()),
    coverImage: null,
    tags: buildTags([]),
  };
}

/** The first paragraph after the README's `# ` title. */
function readIntroParagraph(publicPart: string): string {
  const lines = publicPart.split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => /^# \S/.test(line));
  const paragraph: string[] = [];
  for (const line of lines.slice(titleIndex + 1)) {
    if (line.trim() === '') {
      if (paragraph.length > 0) {
        break;
      }
      continue;
    }
    if (paragraph.length === 0 && /^(#|\||<!--)/.test(line.trim())) {
      break;
    }
    paragraph.push(line);
  }
  if (titleIndex === -1 || paragraph.length === 0) {
    throw new BlogTransformError(SERIES_README_PATH, [
      'no intro paragraph under the "# " title to open the index post with',
    ]);
  }
  return paragraph.join('\n');
}

/**
 * Every part, from the series index table and the post files, in part order. A post file's
 * title and status win over its table row (the checker keeps them in sync anyway); a part with
 * no file is listed from its row.
 */
function readEntries(publicPart: string, allPosts: readonly LoadedPost[]): IndexEntry[] {
  const rows = readTableAfterHeading(publicPart, SERIES_INDEX_HEADING);
  if (rows === null) {
    throw new BlogTransformError(SERIES_README_PATH, [
      `no table under "## ${SERIES_INDEX_HEADING}" above the ${PUBLIC_INDEX_END_MARKER} marker`,
    ]);
  }

  const entriesByPart = new Map<number, IndexEntry>();
  const finalRowParts: number[] = [];
  const problems: string[] = [];
  for (const row of rows) {
    const [partCell = '', title = '', status = ''] = row.cells;
    if (!/^\d+$/.test(partCell)) {
      problems.push(`"${partCell}" in the series index is not a part number`);
      continue;
    }
    const part = Number(partCell);
    entriesByPart.set(part, { part, title, published: null });
    if (status === 'final') {
      finalRowParts.push(part);
    }
  }
  for (const post of allPosts) {
    const { part, title, status } = post.frontmatter;
    entriesByPart.set(part, { part, title, published: status === 'final' ? post : null });
  }
  // Only a post file says where a published part lives, so a final row needs a final file.
  for (const part of finalRowParts) {
    if (entriesByPart.get(part)?.published === null) {
      problems.push(`part ${String(part)} is final in the series index but has no final post file`);
    }
  }
  if (problems.length > 0) {
    throw new BlogTransformError(SERIES_README_PATH, problems);
  }
  return [...entriesByPart.values()].sort((left, right) => left.part - right.part);
}

function publishedItem(entry: IndexEntry & { readonly published: LoadedPost }): string {
  const post = entry.published;
  const link = `[${escapeMarkdownText(post.frontmatter.title)}](/blog/${post.frontmatter.slug})`;
  const lines = [`- **Part ${String(entry.part)}: ${link}**`];
  const excerpt = post.frontmatter.excerpt;
  if (excerpt !== undefined) {
    lines.push('', `  ${escapeMarkdownText(excerpt)}`);
  }
  return lines.join('\n');
}

function isPublished(entry: IndexEntry): entry is IndexEntry & { readonly published: LoadedPost } {
  return entry.published !== null;
}

function comingUpItem(entry: IndexEntry): string {
  return `- Part ${String(entry.part)}: ${escapeMarkdownText(entry.title)}`;
}
