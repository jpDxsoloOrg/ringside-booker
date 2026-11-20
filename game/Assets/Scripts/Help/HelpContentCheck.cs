using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace RingsideBooker.Help
{
    /// <summary>
    /// The help content check (POL5-01): every rule a careless edit could break, as a list of
    /// problems (empty = fine). The EditMode test runs it over the shipped files, so a broken link
    /// or a stray "minutes" fails the build instead of reaching players.
    /// <list type="bullet">
    /// <item>the index reads; slugs are valid and unique; titles unique; summaries at most 160 characters;</item>
    /// <item>every article's section exists and every section is used;</item>
    /// <item>every index entry has a file and every file has an entry;</item>
    /// <item>every <c>help:</c> link and anchor resolves; every <c>screen:</c> id and <c>screens</c> id is a known screen;</item>
    /// <item>no raw HTML, no minutes (D-10), no unknown directives, at most 1,200 words an article.</item>
    /// </list>
    /// </summary>
    public static class HelpContentCheck
    {
        public const int MaxWords = 1200;
        public const int MaxSummary = 160;

        private static readonly Regex Minutes = new Regex(@"\bminutes?\b|\bmins?\b", RegexOptions.IgnoreCase);
        private static readonly Regex Html = new Regex(@"<[a-z!/]", RegexOptions.IgnoreCase);
        private static readonly Regex CodeSpan = new Regex("`[^`]*`");

        /// <summary>Directives the renderer knows (none yet; POL5-04 adds <c>example-why</c>).</summary>
        public static readonly HashSet<string> KnownDirectives = new HashSet<string>();

        public static List<string> Run(HelpLibrary library, ICollection<string> knownScreens)
        {
            var problems = new List<string>();
            if (library.Problem != null)
            {
                problems.Add(library.Problem);
                return problems;
            }
            HelpIndex index = library.Index;
            if (index.Articles.Count == 0) problems.Add("index.json lists no articles");

            var slugs = new HashSet<string>();
            var titles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var sectionIds = new HashSet<string>(index.Sections.Select(section => section.Id));
            foreach (HelpArticleMeta meta in index.Articles)
            {
                string where = $"index.json {meta.Slug ?? "(no slug)"}";
                if (!HelpMarkdown.IsSlug(meta.Slug)) problems.Add($"{where}: the slug must be kebab-case, at most 48 characters");
                else if (!slugs.Add(meta.Slug)) problems.Add($"{where}: the slug is used twice");
                if (string.IsNullOrWhiteSpace(meta.Title)) problems.Add($"{where}: no title");
                else if (!titles.Add(meta.Title)) problems.Add($"{where}: the title \"{meta.Title}\" is used twice");
                if (string.IsNullOrWhiteSpace(meta.Summary)) problems.Add($"{where}: no summary");
                else if (meta.Summary.Length > MaxSummary) problems.Add($"{where}: the summary is over {MaxSummary} characters");
                if (!sectionIds.Contains(meta.Section)) problems.Add($"{where}: unknown section \"{meta.Section}\"");
                foreach (string screen in meta.Screens)
                {
                    if (!knownScreens.Contains(screen)) problems.Add($"{where}: unknown screen \"{screen}\"");
                }
                foreach (string text in new[] { meta.Title, meta.Summary }.Concat(meta.Keywords))
                {
                    if (text != null && Minutes.IsMatch(text)) problems.Add($"{where}: mentions minutes (D-10: shows have slots, not minutes)");
                }
            }
            foreach (HelpSection section in index.Sections)
            {
                if (index.Articles.All(meta => meta.Section != section.Id)) problems.Add($"index.json: section \"{section.Id}\" has no articles");
            }
            if (sectionIds.Count != index.Sections.Count) problems.Add("index.json: a section id is used twice");

            string articlesFolder = Path.Combine(library.Folder, "articles");
            if (Directory.Exists(articlesFolder))
            {
                foreach (string file in Directory.GetFiles(articlesFolder, "*.md"))
                {
                    string slug = Path.GetFileNameWithoutExtension(file);
                    if (!slugs.Contains(slug)) problems.Add($"articles/{slug}.md has no entry in index.json");
                }
            }

            foreach (HelpArticleMeta meta in index.Articles.Where(meta => HelpMarkdown.IsSlug(meta.Slug)))
            {
                string where = $"articles/{meta.Slug}.md";
                string source = library.ReadArticleText(meta.Slug);
                if (source == null)
                {
                    problems.Add($"{where}: the file is missing");
                    continue;
                }
                problems.AddRange(CheckText(where, source));
                HelpArticle article = library.Article(meta.Slug);
                foreach (HelpBlock directive in article.Blocks.Where(block => block.Kind == HelpBlockKind.Directive))
                {
                    if (!KnownDirectives.Contains(directive.Name)) problems.Add($"{where}: unknown directive ::{directive.Name}");
                }
                foreach (HelpLinkTarget link in HelpMarkdown.Links(article.Blocks))
                {
                    if (link.Kind == HelpLinkKind.Help)
                    {
                        HelpArticle target = library.Meta(link.Slug) != null ? library.Article(link.Slug) : null;
                        if (target == null) problems.Add($"{where}: the link {link} goes to an unknown article");
                        else if (link.Anchor != null && target.Headings.All(heading => heading.Anchor != link.Anchor))
                        {
                            problems.Add($"{where}: the link {link} goes to an unknown heading");
                        }
                    }
                    else if (link.Kind == HelpLinkKind.Screen && !knownScreens.Contains(link.ScreenId))
                    {
                        problems.Add($"{where}: the link {link} goes to an unknown screen");
                    }
                }
            }
            return problems;
        }

        /// <summary>The text rules for one article: no raw HTML outside code, no minutes, a word limit.</summary>
        public static IEnumerable<string> CheckText(string where, string source)
        {
            string[] lines = source.Replace("\r\n", "\n").Split('\n');
            for (int i = 0; i < lines.Length; i++)
            {
                string outsideCode = CodeSpan.Replace(lines[i], string.Empty);
                if (Html.IsMatch(outsideCode)) yield return $"{where}:{i + 1}: raw HTML is not allowed";
                if (Minutes.IsMatch(lines[i])) yield return $"{where}:{i + 1}: mentions minutes (D-10: shows have slots, not minutes)";
                if (lines[i].TrimStart().StartsWith("# ", StringComparison.Ordinal)) yield return $"{where}:{i + 1}: use ## or ### headings (the title comes from index.json)";
                if (lines[i].Contains("![")) yield return $"{where}:{i + 1}: images are not supported yet";
                if (lines[i].TrimStart().StartsWith("|", StringComparison.Ordinal)) yield return $"{where}:{i + 1}: tables are not supported";
            }
            int words = source.Split(new[] { ' ', '\n', '\t' }, StringSplitOptions.RemoveEmptyEntries).Length;
            if (words > MaxWords) yield return $"{where}: {words} words (at most {MaxWords})";
        }
    }
}
