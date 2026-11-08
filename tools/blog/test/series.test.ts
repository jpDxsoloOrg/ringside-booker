import { compile } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';

import type { PostStatus } from '../src/frontmatter';
import type { LoadedPost } from '../src/load';
import {
  SERIES_INDEX_PATH,
  buildSeriesNav,
  escapeMarkdownText,
  findPublishedNeighbours,
} from '../src/series';

function makePost(
  part: number,
  status: PostStatus,
  title = `Part ${String(part)} title`,
): LoadedPost {
  const label = String(part).padStart(2, '0');
  return {
    path: `docs/blog/${label}-part-${label}.md`,
    fileName: `${label}-part-${label}.md`,
    partFromFileName: part,
    frontmatter: {
      title,
      slug: `ringside-booker-${label}-part-${label}`,
      series: 'ringside-booker',
      part,
      status,
      excerpt: 'An excerpt long enough to pass the frontmatter rules for a post.',
      tags: ['gamedev'],
      journal: [],
    },
    body: 'Body text.\n',
  };
}

const partOne = makePost(1, 'final');
const partTwo = makePost(2, 'draft');
const partThree = makePost(3, 'final');
const series = [partOne, partTwo, partThree];

interface TreeNode {
  readonly type: string;
  readonly children?: readonly TreeNode[];
}

function collectTypes(node: TreeNode, types: Set<string>): void {
  types.add(node.type);
  for (const child of node.children ?? []) {
    collectTypes(child, types);
  }
}

/** Compiles like the blog does and returns every node type, so MDX-only nodes can be spotted. */
async function compiledNodeTypes(content: string): Promise<Set<string>> {
  const types = new Set<string>();
  const recordTypes = () => (tree: TreeNode) => {
    collectTypes(tree, types);
  };
  await compile(content, { remarkPlugins: [remarkGfm, recordTypes] });
  return types;
}

const linkTo = (post: LoadedPost): string => `(/blog/${post.frontmatter.slug})`;

describe('findPublishedNeighbours', () => {
  it('skips drafts: part 1 and part 3 are each other’s neighbours', () => {
    expect(findPublishedNeighbours(1, series)).toEqual({ previous: null, next: partThree });
    expect(findPublishedNeighbours(3, series)).toEqual({ previous: partOne, next: null });
  });

  it('gives a draft its published neighbours on both sides', () => {
    expect(findPublishedNeighbours(2, series)).toEqual({ previous: partOne, next: partThree });
  });

  it('picks the nearest final part on each side, whatever the order of the list', () => {
    const many = [makePost(7, 'final'), makePost(2, 'final'), makePost(5, 'final')];
    const neighbours = findPublishedNeighbours(4, many);
    expect(neighbours.previous?.frontmatter.part).toBe(2);
    expect(neighbours.next?.frontmatter.part).toBe(5);
  });
});

describe('buildSeriesNav', () => {
  it('links part 1 forward to part 3 and part 3 back to part 1, never to the draft', () => {
    const first = buildSeriesNav(partOne, series);
    expect(first.footer).toContain(`**Next part:** [Part 3 title]${linkTo(partThree)}`);
    expect(first.footer).not.toContain('**Previous part:**');

    const third = buildSeriesNav(partThree, series);
    expect(third.footer).toContain(`**Previous part:** [Part 1 title]${linkTo(partOne)}`);
    expect(third.footer).not.toContain('**Next part:**');

    for (const nav of series.map((post) => buildSeriesNav(post, series))) {
      expect(`${nav.header}\n${nav.footer}`).not.toContain(linkTo(partTwo));
    }
  });

  it('gives the draft part 2 a previous link to part 1 and a next link to part 3', () => {
    const { footer } = buildSeriesNav(partTwo, series);
    expect(footer).toContain(`**Previous part:** [Part 1 title]${linkTo(partOne)}`);
    expect(footer).toContain(`**Next part:** [Part 3 title]${linkTo(partThree)}`);
  });

  it('gives a lone final post neither a previous nor a next link', () => {
    const { footer } = buildSeriesNav(partOne, [partOne]);
    expect(footer).not.toContain('Previous');
    expect(footer).not.toContain('Next');
    expect(footer).toBe(`---\n\nAll parts: [series index](${SERIES_INDEX_PATH})`);
  });

  it('names the part in the header and links the index', () => {
    const { header } = buildSeriesNav(partThree, series);
    expect(header).toContain('Part 3');
    expect(header).toBe(
      '*Part 3 of the [Ringside Booker series](/blog/ringside-booker-series): building a wrestling booking sim in the open.*',
    );
  });

  it('puts every footer link in its own paragraph after a rule', () => {
    const paragraphs = buildSeriesNav(partTwo, series).footer.split('\n\n');
    expect(paragraphs).toEqual([
      '---',
      `**Previous part:** [Part 1 title]${linkTo(partOne)}`,
      `**Next part:** [Part 3 title]${linkTo(partThree)}`,
      `All parts: [series index](${SERIES_INDEX_PATH})`,
    ]);
  });

  it('compiles as MDX, even around titles with MDX-hostile characters', async () => {
    const awkward = makePost(1, 'final', 'Traced<T> and {braces} with *stars* [and] `ticks` & co');
    const posts = [awkward, partTwo, partThree];
    for (const post of posts) {
      const nav = buildSeriesNav(post, posts);
      const content = `${nav.header}\n\nBody text.\n\n${nav.footer}\n`;
      const types = await compiledNodeTypes(content);
      // No JSX, no expressions: the text renders as the same text.
      expect([...types].filter((type) => type.startsWith('mdx'))).toEqual([]);
      expect(types).toContain('thematicBreak');
    }
    const { footer } = buildSeriesNav(partTwo, posts);
    expect(footer).toContain(
      '[Traced\\<T\\> and \\{braces\\} with \\*stars\\* \\[and\\] \\`ticks\\` \\& co]',
    );
  });
});

describe('escapeMarkdownText', () => {
  it('leaves ordinary prose alone', () => {
    expect(escapeMarkdownText("Why I'm building a booking sim: part one.")).toBe(
      "Why I'm building a booking sim: part one.",
    );
  });
});
