/**
 * Turns a tag name into the slug the blog stores in `tags.slug`.
 *
 * This must stay identical to the blog's own slug rule. The publisher creates missing tags by
 * slug, so if the two rules ever disagree, the same tag name ends up as two different tags (or a
 * unique-slug conflict). The blog lives in a separate repo with its own deploy cycle, so the rule
 * is copied rather than imported; test/slugify.test.ts pins the behaviour.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-');
}
