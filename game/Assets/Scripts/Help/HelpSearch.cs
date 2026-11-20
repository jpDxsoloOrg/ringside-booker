using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace RingsideBooker.Help
{
    /// <summary>One search hit: the article, a line to show, and where the best match was.</summary>
    public sealed class HelpSearchResult
    {
        public string Slug;
        public string Title;
        public string Snippet;
        /// <summary>"title", "keyword", "heading" or "body".</summary>
        public string MatchedIn;
        public int Score;
    }

    /// <summary>
    /// Search over the help (POL5-02): words are lower-cased and accent-folded, at least two
    /// characters, and match the start of a word ("sav" finds "saving"). Every query word must
    /// match somewhere in an article. An article scores the weights of the places each word
    /// matched (<see cref="Weights"/>, UI constants, not game tunables); ties go by section order,
    /// then the article's order.
    /// </summary>
    public sealed class HelpSearchIndex
    {
        public static class Weights
        {
            public const int Title = 8;
            public const int Keyword = 6;
            public const int Heading = 4;
            public const int Body = 1;
        }

        private sealed class Entry
        {
            public HelpArticleMeta Meta;
            public int SectionOrder;
            public HashSet<string> Title;
            public HashSet<string> Keywords;
            public HashSet<string> Headings;
            public HashSet<string> Body;
            public List<string> Paragraphs;
        }

        private readonly List<Entry> entries = new List<Entry>();

        public static HelpSearchIndex Build(HelpLibrary library)
        {
            var index = new HelpSearchIndex();
            foreach (HelpArticleMeta meta in library.Index.Articles)
            {
                HelpArticle article = library.Article(meta.Slug);
                List<HelpBlock> blocks = article?.Blocks ?? new List<HelpBlock>();
                var paragraphs = new List<string>();
                foreach (HelpBlock block in blocks.Where(block => block.Kind != HelpBlockKind.Heading))
                {
                    if (block.Inlines.Count > 0) paragraphs.Add(HelpMarkdown.PlainText(block.Inlines));
                    paragraphs.AddRange(block.Items.Select(HelpMarkdown.PlainText));
                }
                index.entries.Add(new Entry
                {
                    Meta = meta,
                    SectionOrder = library.SectionOf(meta)?.Order ?? int.MaxValue,
                    Title = Tokens(meta.Title).ToHashSet(),
                    Keywords = meta.Keywords.SelectMany(Tokens).ToHashSet(),
                    Headings = blocks.Where(block => block.Kind == HelpBlockKind.Heading).SelectMany(block => Tokens(HelpMarkdown.PlainText(block.Inlines))).ToHashSet(),
                    Body = paragraphs.SelectMany(Tokens).Concat(Tokens(meta.Summary)).ToHashSet(),
                    Paragraphs = paragraphs,
                });
            }
            return index;
        }

        /// <summary>The best matches for <paramref name="query"/>, best first (empty for a blank query).</summary>
        public List<HelpSearchResult> Find(string query, int limit = 20)
        {
            List<string> words = Tokens(query).Distinct().ToList();
            var results = new List<(HelpSearchResult result, int section, int order)>();
            if (words.Count == 0) return new List<HelpSearchResult>();
            foreach (Entry entry in entries)
            {
                int score = 0;
                string best = null;
                int bestWeight = 0;
                bool all = true;
                foreach (string word in words)
                {
                    int wordScore = 0;
                    void Try(HashSet<string> tokens, int weight, string where)
                    {
                        if (!tokens.Any(token => token.StartsWith(word, StringComparison.Ordinal))) return;
                        wordScore += weight;
                        if (weight > bestWeight)
                        {
                            bestWeight = weight;
                            best = where;
                        }
                    }
                    Try(entry.Title, Weights.Title, "title");
                    Try(entry.Keywords, Weights.Keyword, "keyword");
                    Try(entry.Headings, Weights.Heading, "heading");
                    Try(entry.Body, Weights.Body, "body");
                    if (wordScore == 0)
                    {
                        all = false;
                        break;
                    }
                    score += wordScore;
                }
                if (!all) continue;
                results.Add((new HelpSearchResult
                {
                    Slug = entry.Meta.Slug,
                    Title = entry.Meta.Title,
                    Snippet = Snippet(entry, words),
                    MatchedIn = best,
                    Score = score,
                }, entry.SectionOrder, entry.Meta.Order));
            }
            return results.OrderByDescending(item => item.result.Score)
                .ThenBy(item => item.section)
                .ThenBy(item => item.order)
                .ThenBy(item => item.result.Title, StringComparer.Ordinal)
                .Take(limit)
                .Select(item => item.result)
                .ToList();
        }

        /// <summary>Lower-cased, accent-folded words of two or more letters or digits.</summary>
        public static IEnumerable<string> Tokens(string text)
        {
            string folded = HelpMarkdown.Fold(text ?? string.Empty);
            var word = new StringBuilder();
            foreach (char c in folded + " ")
            {
                if (char.IsLetterOrDigit(c))
                {
                    word.Append(c);
                    continue;
                }
                if (c == '\'' || c == '’') continue;
                if (word.Length >= 2) yield return word.ToString();
                word.Clear();
            }
        }

        /// <summary>The first paragraph that holds a query word (cut to about 160 characters), else the summary.</summary>
        private static string Snippet(Entry entry, List<string> words)
        {
            foreach (string paragraph in entry.Paragraphs)
            {
                if (!Tokens(paragraph).Any(token => words.Any(word => token.StartsWith(word, StringComparison.Ordinal)))) continue;
                return paragraph.Length <= 160 ? paragraph : paragraph.Substring(0, 157).TrimEnd() + "…";
            }
            return entry.Meta.Summary;
        }
    }
}
