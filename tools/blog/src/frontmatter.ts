import { z } from 'zod';

// The fields, types and rules here are the ones documented in the "Frontmatter" section of
// docs/blog/README.md (docs/blog/README.md#frontmatter). Change both together.

/** Every post belongs to this series, and every pushed post gets this tag. */
export const SERIES_NAME = 'ringside-booker';

export const POST_STATUSES = ['planned', 'outline', 'draft', 'final'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** Post files are `NN-<kebab-title>.md`; README.md and `_`-prefixed files never match. */
export const POST_FILE_NAME_PATTERN = /^\d{2}-[a-z0-9-]+\.md$/;

export const SLUG_PATTERN = /^ringside-booker-[a-z0-9]+(-[a-z0-9]+)*$/;
export const TAG_PATTERN = /^[a-z0-9][a-z0-9 -]{0,30}$/;
const JOURNAL_PATH_PATTERN = /^docs\/dev-journal\/[^/_][^/]*\.md$/;

const STATUSES_NEEDING_EXCERPT: readonly PostStatus[] = ['draft', 'final'];

export const PostFrontmatter = z
  .object({
    title: z.string().trim().min(1).max(90),
    slug: z.string().regex(SLUG_PATTERN, {
      error: 'slug must look like ringside-booker-NN-kebab-title',
    }),
    series: z.literal(SERIES_NAME),
    part: z.int().min(1),
    status: z.enum(POST_STATUSES),
    excerpt: z.string().trim().min(50).max(200).optional(),
    tags: z
      .array(
        z.string().regex(TAG_PATTERN, {
          error: 'tags are lowercase letters, digits, spaces and hyphens, 31 characters or fewer',
        }),
      )
      .min(1)
      .max(6),
    publishedAt: z.iso.date({ error: 'publishedAt must be an ISO date, YYYY-MM-DD' }).optional(),
    coverImage: z
      .url({ protocol: /^https$/, error: 'coverImage must be an https:// URL' })
      .optional(),
    journal: z.array(
      z.string().regex(JOURNAL_PATH_PATTERN, {
        error: 'journal entries are paths like docs/dev-journal/2026-11-topic.md',
      }),
    ),
  })
  .strict()
  .superRefine((frontmatter, context) => {
    if (
      STATUSES_NEEDING_EXCERPT.includes(frontmatter.status) &&
      frontmatter.excerpt === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['excerpt'],
        message: `excerpt is required when status is ${frontmatter.status}`,
      });
    }
    const seenTags = new Set<string>();
    frontmatter.tags.forEach((tag, index) => {
      if (seenTags.has(tag)) {
        context.addIssue({
          code: 'custom',
          path: ['tags', index],
          message: `duplicate tag "${tag}"`,
        });
      }
      seenTags.add(tag);
    });
  });

export type PostFrontmatter = z.infer<typeof PostFrontmatter>;
