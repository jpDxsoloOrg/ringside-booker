import type { LoadedPost } from './load';

// Series navigation, generated into each part's content: a header line naming the part and a
// footer with the previous and next published parts and a link to the series index. It lives in
// the content rather than in the blog's templates because the blog is shared with other writing.
// Only `final` posts are published, so only they are ever linked.

/** The series index post's slug. It keeps the `ringside-booker-` prefix every slug has. */
export const SERIES_INDEX_SLUG = 'ringside-booker-series';
export const SERIES_INDEX_PATH = `/blog/${SERIES_INDEX_SLUG}`;

export interface SeriesNav {
  /** One italic line that goes before the first body line. */
  readonly header: string;
  /** A rule, then one paragraph per link, that goes after the last body line. */
  readonly footer: string;
}

export interface SeriesNeighbours {
  /** The nearest lower part that is `final`, or null. */
  readonly previous: LoadedPost | null;
  /** The nearest higher part that is `final`, or null. */
  readonly next: LoadedPost | null;
}

/** The published (`final`) parts either side of `part`. The part itself never counts. */
export function findPublishedNeighbours(
  part: number,
  allPosts: readonly LoadedPost[],
): SeriesNeighbours {
  let previous: LoadedPost | null = null;
  let next: LoadedPost | null = null;
  for (const candidate of allPosts) {
    const candidatePart = candidate.frontmatter.part;
    if (candidate.frontmatter.status !== 'final' || candidatePart === part) {
      continue;
    }
    if (candidatePart < part && (previous === null || candidatePart > previous.frontmatter.part)) {
      previous = candidate;
    }
    if (candidatePart > part && (next === null || candidatePart < next.frontmatter.part)) {
      next = candidate;
    }
  }
  return { previous, next };
}

/** The header and footer for one part. Pure: the same posts always give the same text. */
export function buildSeriesNav(post: LoadedPost, allPosts: readonly LoadedPost[]): SeriesNav {
  const { previous, next } = findPublishedNeighbours(post.frontmatter.part, allPosts);
  const header =
    `*Part ${String(post.frontmatter.part)} of the [Ringside Booker series](${SERIES_INDEX_PATH}): ` +
    'building a wrestling booking sim in the open.*';

  // One paragraph per link, so on a narrow screen no two links share a line.
  const paragraphs = ['---'];
  if (previous !== null) {
    paragraphs.push(`**Previous part:** ${postLink(previous)}`);
  }
  if (next !== null) {
    paragraphs.push(`**Next part:** ${postLink(next)}`);
  }
  paragraphs.push(`All parts: [series index](${SERIES_INDEX_PATH})`);
  return { header, footer: paragraphs.join('\n\n') };
}

function postLink(post: LoadedPost): string {
  return `[${escapeMarkdownText(post.frontmatter.title)}](/blog/${post.frontmatter.slug})`;
}

/**
 * Escapes plain text (a title, an excerpt) so it reads as the same text in Markdown and MDX:
 * no emphasis, no links, no JSX tags, no expressions, no entities.
 */
export function escapeMarkdownText(text: string): string {
  return text.replace(/[\\`*_[\]{}<>&~|#]/g, (character) => `\\${character}`);
}
