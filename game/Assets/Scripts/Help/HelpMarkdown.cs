using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace RingsideBooker.Help
{
    public enum HelpBlockKind
    {
        Heading,
        Paragraph,
        List,
        Callout,
        Directive,
    }

    public enum HelpInlineKind
    {
        Text,
        Strong,
        Em,
        Code,
        Link,
        Term,
    }

    public enum HelpLinkKind
    {
        Help,
        Screen,
        External,
    }

    /// <summary>Where a link goes: another article (and a heading in it), a game screen, or an https page.</summary>
    public sealed class HelpLinkTarget
    {
        public HelpLinkKind Kind;
        /// <summary>The article's slug, for <see cref="HelpLinkKind.Help"/>.</summary>
        public string Slug;
        /// <summary>A heading anchor in the article, or null.</summary>
        public string Anchor;
        /// <summary>The nav item or screen id, for <see cref="HelpLinkKind.Screen"/>.</summary>
        public string ScreenId;
        /// <summary>The https address, for <see cref="HelpLinkKind.External"/>.</summary>
        public string Href;

        public override string ToString() => Kind switch
        {
            HelpLinkKind.Help => "help:" + Slug + (Anchor != null ? "#" + Anchor : string.Empty),
            HelpLinkKind.Screen => "screen:" + ScreenId,
            _ => Href,
        };
    }

    /// <summary>A run of text in a block: plain text, bold, italic, a key or code, a link, or a term.</summary>
    public sealed class HelpInline
    {
        public HelpInlineKind Kind;
        /// <summary>The words, for text, code and terms.</summary>
        public string Text;
        /// <summary>A term's id (the lexicon comes later; terms render as their text for now).</summary>
        public string TermId;
        public HelpLinkTarget Link;
        /// <summary>Inner runs, for bold, italic and links.</summary>
        public List<HelpInline> Children = new List<HelpInline>();

        public static HelpInline Plain(string text) => new HelpInline { Kind = HelpInlineKind.Text, Text = text };
    }

    /// <summary>One block of an article: a heading, a paragraph, a list, a Tip/Note callout or a <c>::directive</c>.</summary>
    public sealed class HelpBlock
    {
        public HelpBlockKind Kind;
        /// <summary>2 or 3, for headings.</summary>
        public int Level;
        /// <summary>The heading's anchor (explicit <c>{#id}</c> or made from its words; repeats get -2, -3).</summary>
        public string Anchor;
        /// <summary>"tip" or "note", for callouts.</summary>
        public string CalloutKind;
        /// <summary>The directive's name.</summary>
        public string Name;
        public bool Ordered;
        public List<HelpInline> Inlines = new List<HelpInline>();
        /// <summary>One list of runs per list item.</summary>
        public List<List<HelpInline>> Items = new List<List<HelpInline>>();
    }

    /// <summary>
    /// The help articles' small Markdown subset (POL5-01/02), parsed into blocks and runs. It never
    /// produces markup: anything outside the subset stays literal text, links go only to
    /// <c>help:</c>, <c>screen:</c> and <c>https:</c> targets (anything else becomes its words), and
    /// the renderer escapes every run, so an article cannot inject rich-text tags or script.
    /// <para>
    /// Blocks: <c>##</c>/<c>###</c> headings (optional <c>{#anchor}</c>), paragraphs, one level of
    /// <c>-</c>/<c>*</c> and <c>1.</c> lists, callouts <c>&gt; **Tip:** …</c> / <c>&gt; **Note:** …</c>,
    /// directives <c>::name</c>. Runs: <c>**bold**</c>, <c>*italic*</c>/<c>_italic_</c>,
    /// <c>`code`</c>, <c>[text](target)</c>, terms <c>[[id]]</c>/<c>[[id|text]]</c> and backslash escapes.
    /// </para>
    /// </summary>
    public static class HelpMarkdown
    {
        public static List<HelpBlock> Parse(string text)
        {
            var blocks = new List<HelpBlock>();
            var anchors = new Dictionary<string, int>();
            string[] lines = (text ?? string.Empty).Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
            var paragraph = new List<string>();
            HelpBlock list = null;
            List<string> callout = null;

            void FlushParagraph()
            {
                if (paragraph.Count == 0) return;
                blocks.Add(new HelpBlock { Kind = HelpBlockKind.Paragraph, Inlines = ParseInlines(string.Join(" ", paragraph)) });
                paragraph.Clear();
            }

            void FlushCallout()
            {
                if (callout == null) return;
                string body = string.Join(" ", callout).Trim();
                string kind = "note";
                foreach (string label in new[] { "Tip", "Note" })
                {
                    string marker = "**" + label + ":**";
                    if (!body.StartsWith(marker, StringComparison.Ordinal)) continue;
                    kind = label.ToLowerInvariant();
                    body = body.Substring(marker.Length).TrimStart();
                    break;
                }
                blocks.Add(new HelpBlock { Kind = HelpBlockKind.Callout, CalloutKind = kind, Inlines = ParseInlines(body) });
                callout = null;
            }

            void FlushAll()
            {
                FlushParagraph();
                FlushCallout();
                list = null;
            }

            foreach (string raw in lines)
            {
                string line = raw.TrimEnd();
                string trimmed = line.TrimStart();
                if (trimmed.Length == 0)
                {
                    FlushAll();
                    continue;
                }

                if (trimmed.StartsWith(">", StringComparison.Ordinal))
                {
                    FlushParagraph();
                    list = null;
                    callout ??= new List<string>();
                    callout.Add(trimmed.Substring(1).Trim());
                    continue;
                }
                FlushCallout();

                if (TryHeading(trimmed, out int level, out string words, out string explicitAnchor))
                {
                    FlushAll();
                    string anchor = UniqueAnchor(explicitAnchor ?? Anchor(words), anchors);
                    blocks.Add(new HelpBlock { Kind = HelpBlockKind.Heading, Level = level, Anchor = anchor, Inlines = ParseInlines(words) });
                    continue;
                }

                if (trimmed.StartsWith("::", StringComparison.Ordinal) && IsDirectiveName(trimmed.Substring(2)))
                {
                    FlushAll();
                    blocks.Add(new HelpBlock { Kind = HelpBlockKind.Directive, Name = trimmed.Substring(2) });
                    continue;
                }

                if (TryListItem(trimmed, out bool ordered, out string itemText))
                {
                    FlushParagraph();
                    if (list == null || list.Ordered != ordered)
                    {
                        list = new HelpBlock { Kind = HelpBlockKind.List, Ordered = ordered };
                        blocks.Add(list);
                    }
                    list.Items.Add(ParseInlines(itemText));
                    continue;
                }

                // An indented line right after a list item continues that item.
                if (list != null && line.Length > trimmed.Length && list.Items.Count > 0)
                {
                    List<HelpInline> last = list.Items[list.Items.Count - 1];
                    last.Add(HelpInline.Plain(" "));
                    last.AddRange(ParseInlines(trimmed));
                    continue;
                }

                list = null;
                paragraph.Add(trimmed);
            }
            FlushAll();
            return blocks;
        }

        /// <summary>
        /// A heading's anchor: lower case, letters and digits kept (accents folded), every other run
        /// of characters a single hyphen. "The day button" → "the-day-button".
        /// </summary>
        public static string Anchor(string words)
        {
            string folded = Fold(StripMarkers(words ?? string.Empty));
            var anchor = new StringBuilder();
            bool hyphen = false;
            foreach (char c in folded)
            {
                if (char.IsLetterOrDigit(c))
                {
                    if (hyphen && anchor.Length > 0) anchor.Append('-');
                    anchor.Append(char.ToLowerInvariant(c));
                    hyphen = false;
                }
                else if (c != '\'' && c != '’')
                {
                    hyphen = true;
                }
            }
            return anchor.Length > 0 ? anchor.ToString() : "section";
        }

        /// <summary>Lower case with accents removed (NFD, marks dropped): "Café" → "cafe".</summary>
        public static string Fold(string text)
        {
            if (string.IsNullOrEmpty(text)) return string.Empty;
            string decomposed = text.Normalize(NormalizationForm.FormD);
            var folded = new StringBuilder(decomposed.Length);
            foreach (char c in decomposed)
            {
                if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) folded.Append(char.ToLowerInvariant(c));
            }
            return folded.ToString().Normalize(NormalizationForm.FormC);
        }

        /// <summary>The plain words of runs (links and marks dropped), for search and anchors.</summary>
        public static string PlainText(IEnumerable<HelpInline> inlines)
        {
            var text = new StringBuilder();
            AppendPlain(text, inlines);
            return text.ToString();
        }

        /// <summary>Every link in the blocks, in order (the content check resolves them).</summary>
        public static IEnumerable<HelpLinkTarget> Links(IEnumerable<HelpBlock> blocks)
        {
            foreach (HelpBlock block in blocks)
            {
                foreach (HelpLinkTarget target in Links(block.Inlines)) yield return target;
                foreach (List<HelpInline> item in block.Items)
                {
                    foreach (HelpLinkTarget target in Links(item)) yield return target;
                }
            }
        }

        private static IEnumerable<HelpLinkTarget> Links(IEnumerable<HelpInline> inlines)
        {
            foreach (HelpInline inline in inlines)
            {
                if (inline.Kind == HelpInlineKind.Link && inline.Link != null) yield return inline.Link;
                foreach (HelpLinkTarget inner in Links(inline.Children)) yield return inner;
            }
        }

        /// <summary>Parses one line's runs. Unclosed markers and unknown syntax stay literal.</summary>
        public static List<HelpInline> ParseInlines(string text)
        {
            var runs = new List<HelpInline>();
            var plain = new StringBuilder();
            text ??= string.Empty;

            void FlushPlain()
            {
                if (plain.Length == 0) return;
                runs.Add(HelpInline.Plain(plain.ToString()));
                plain.Clear();
            }

            int i = 0;
            while (i < text.Length)
            {
                char c = text[i];
                if (c == '\\' && i + 1 < text.Length && char.IsPunctuation(text[i + 1]) || c == '\\' && i + 1 < text.Length && char.IsSymbol(text[i + 1]))
                {
                    plain.Append(text[i + 1]);
                    i += 2;
                    continue;
                }
                if (c == '`')
                {
                    int close = text.IndexOf('`', i + 1);
                    if (close > i + 1)
                    {
                        FlushPlain();
                        runs.Add(new HelpInline { Kind = HelpInlineKind.Code, Text = text.Substring(i + 1, close - i - 1) });
                        i = close + 1;
                        continue;
                    }
                }
                if (c == '*' && i + 1 < text.Length && text[i + 1] == '*')
                {
                    int close = text.IndexOf("**", i + 2, StringComparison.Ordinal);
                    if (close > i + 2)
                    {
                        FlushPlain();
                        runs.Add(new HelpInline { Kind = HelpInlineKind.Strong, Children = ParseInlines(text.Substring(i + 2, close - i - 2)) });
                        i = close + 2;
                        continue;
                    }
                }
                if ((c == '*' || c == '_') && OpensEmphasis(text, i))
                {
                    int close = ClosingEmphasis(text, i);
                    if (close > i + 1)
                    {
                        FlushPlain();
                        runs.Add(new HelpInline { Kind = HelpInlineKind.Em, Children = ParseInlines(text.Substring(i + 1, close - i - 1)) });
                        i = close + 1;
                        continue;
                    }
                }
                if (c == '[' && i + 1 < text.Length && text[i + 1] == '[')
                {
                    int close = text.IndexOf("]]", i + 2, StringComparison.Ordinal);
                    if (close > i + 2)
                    {
                        string body = text.Substring(i + 2, close - i - 2);
                        int bar = body.IndexOf('|');
                        string id = (bar >= 0 ? body.Substring(0, bar) : body).Trim();
                        string words = bar >= 0 ? body.Substring(bar + 1) : body;
                        FlushPlain();
                        runs.Add(new HelpInline { Kind = HelpInlineKind.Term, TermId = id, Text = words });
                        i = close + 2;
                        continue;
                    }
                }
                if (c == '[' && TryLink(text, i, out string linkText, out string target, out int end))
                {
                    FlushPlain();
                    HelpLinkTarget link = ParseTarget(target);
                    List<HelpInline> children = ParseInlines(linkText);
                    if (link == null)
                    {
                        // Not a target the help may link to (javascript:, data:, http:, …): just its words.
                        runs.AddRange(children);
                    }
                    else
                    {
                        runs.Add(new HelpInline { Kind = HelpInlineKind.Link, Link = link, Children = children });
                    }
                    i = end;
                    continue;
                }
                plain.Append(c);
                i++;
            }
            FlushPlain();
            return runs;
        }

        /// <summary><c>help:slug#anchor</c>, <c>screen:id</c> or <c>https://…</c>; null for anything else.</summary>
        public static HelpLinkTarget ParseTarget(string target)
        {
            target = (target ?? string.Empty).Trim();
            if (target.StartsWith("help:", StringComparison.OrdinalIgnoreCase))
            {
                string rest = target.Substring(5);
                int hash = rest.IndexOf('#');
                string slug = hash >= 0 ? rest.Substring(0, hash) : rest;
                string anchor = hash >= 0 ? rest.Substring(hash + 1) : null;
                if (!IsSlug(slug) || anchor != null && !IsSlug(anchor)) return null;
                return new HelpLinkTarget { Kind = HelpLinkKind.Help, Slug = slug, Anchor = anchor };
            }
            if (target.StartsWith("screen:", StringComparison.OrdinalIgnoreCase))
            {
                string id = target.Substring(7);
                return IsSlug(id) ? new HelpLinkTarget { Kind = HelpLinkKind.Screen, ScreenId = id } : null;
            }
            if (target.StartsWith("https://", StringComparison.OrdinalIgnoreCase) && target.Length > 8 && target.IndexOfAny(new[] { ' ', '"', '<', '>' }) < 0)
            {
                return new HelpLinkTarget { Kind = HelpLinkKind.External, Href = target };
            }
            return null;
        }

        /// <summary>Lower-case letters, digits and single hyphens: "show-night".</summary>
        public static bool IsSlug(string text)
        {
            if (string.IsNullOrEmpty(text) || text.Length > 48 || text[0] == '-' || text[text.Length - 1] == '-') return false;
            for (int i = 0; i < text.Length; i++)
            {
                char c = text[i];
                bool ok = c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' && text[i - 1] != '-';
                if (!ok) return false;
            }
            return true;
        }

        private static bool TryHeading(string line, out int level, out string words, out string anchor)
        {
            level = 0;
            words = null;
            anchor = null;
            if (line.StartsWith("### ", StringComparison.Ordinal)) level = 3;
            else if (line.StartsWith("## ", StringComparison.Ordinal)) level = 2;
            else return false;
            words = line.Substring(level + 1).Trim();
            if (words.EndsWith("}", StringComparison.Ordinal))
            {
                int open = words.LastIndexOf("{#", StringComparison.Ordinal);
                if (open >= 0)
                {
                    string id = words.Substring(open + 2, words.Length - open - 3);
                    if (IsSlug(id))
                    {
                        anchor = id;
                        words = words.Substring(0, open).TrimEnd();
                    }
                }
            }
            return words.Length > 0;
        }

        private static bool TryListItem(string line, out bool ordered, out string text)
        {
            ordered = false;
            text = null;
            if ((line.StartsWith("- ", StringComparison.Ordinal) || line.StartsWith("* ", StringComparison.Ordinal)) && line.Length > 2)
            {
                text = line.Substring(2).Trim();
                return true;
            }
            int digits = 0;
            while (digits < line.Length && digits < 3 && char.IsDigit(line[digits])) digits++;
            if (digits > 0 && digits + 1 < line.Length && line[digits] == '.' && line[digits + 1] == ' ')
            {
                ordered = true;
                text = line.Substring(digits + 2).Trim();
                return true;
            }
            return false;
        }

        private static bool IsDirectiveName(string name) => IsSlug(name);

        private static string UniqueAnchor(string anchor, Dictionary<string, int> seen)
        {
            if (!seen.TryGetValue(anchor, out int count))
            {
                seen[anchor] = 1;
                return anchor;
            }
            count++;
            seen[anchor] = count;
            string next = anchor + "-" + count;
            while (seen.ContainsKey(next))
            {
                count++;
                next = anchor + "-" + count;
            }
            seen[next] = 1;
            return next;
        }

        private static bool OpensEmphasis(string text, int i)
        {
            if (i + 1 >= text.Length || char.IsWhiteSpace(text[i + 1])) return false;
            // An underscore inside a word (snake_case) is not emphasis.
            return text[i] == '*' || i == 0 || !char.IsLetterOrDigit(text[i - 1]);
        }

        private static int ClosingEmphasis(string text, int open)
        {
            char marker = text[open];
            for (int j = open + 2; j < text.Length; j++)
            {
                if (text[j] != marker || char.IsWhiteSpace(text[j - 1])) continue;
                if (marker == '*' && j + 1 < text.Length && text[j + 1] == '*') continue;
                if (marker == '_' && j + 1 < text.Length && char.IsLetterOrDigit(text[j + 1])) continue;
                return j;
            }
            return -1;
        }

        private static bool TryLink(string text, int open, out string linkText, out string target, out int end)
        {
            linkText = null;
            target = null;
            end = open;
            int depth = 0;
            int close = -1;
            for (int j = open; j < text.Length; j++)
            {
                if (text[j] == '\\') { j++; continue; }
                if (text[j] == '[') depth++;
                else if (text[j] == ']' && --depth == 0)
                {
                    close = j;
                    break;
                }
            }
            if (close < 0 || close + 1 >= text.Length || text[close + 1] != '(') return false;
            // The target ends at its matching ")" (a target may hold balanced brackets).
            int paren = -1;
            int open2 = 1;
            for (int j = close + 2; j < text.Length; j++)
            {
                if (text[j] == '(') open2++;
                else if (text[j] == ')' && --open2 == 0)
                {
                    paren = j;
                    break;
                }
            }
            if (paren < 0) return false;
            linkText = text.Substring(open + 1, close - open - 1);
            target = text.Substring(close + 2, paren - close - 2);
            end = paren + 1;
            return linkText.Length > 0;
        }

        private static string StripMarkers(string words) => PlainText(ParseInlines(words));

        private static void AppendPlain(StringBuilder text, IEnumerable<HelpInline> inlines)
        {
            foreach (HelpInline inline in inlines)
            {
                if (inline.Kind == HelpInlineKind.Text || inline.Kind == HelpInlineKind.Code || inline.Kind == HelpInlineKind.Term) text.Append(inline.Text);
                AppendPlain(text, inline.Children);
            }
        }
    }
}
