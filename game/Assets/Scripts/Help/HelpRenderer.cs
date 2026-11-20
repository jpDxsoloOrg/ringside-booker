using System;
using System.Collections.Generic;
using System.Text;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;
using UnityEngine.UIElements.Experimental;

namespace RingsideBooker.Help
{
    /// <summary>
    /// Turns parsed help runs into UI Toolkit rich text that only this class writes: every piece of
    /// article text is escaped (a <c>&lt;</c> can never start a tag), so the only tags are the bold,
    /// italic, colour and link tags made here. Pure, so it is tested without a panel.
    /// </summary>
    public static class HelpRichText
    {
        /// <summary>Link colour (the design system's data cyan, --ds-data).</summary>
        public const string LinkColor = "#00E5FF";
        /// <summary>Keys and code (--ds-gold).</summary>
        public const string CodeColor = "#FACC15";

        /// <summary>
        /// The rich text for <paramref name="inlines"/>. Links the reader can follow
        /// (<paramref name="followable"/>) become <c>&lt;link="N"&gt;</c> tags whose N indexes
        /// <paramref name="links"/>; others are plain words.
        /// </summary>
        public static string Markup(IEnumerable<HelpInline> inlines, List<HelpLinkTarget> links, Func<HelpLinkTarget, bool> followable)
        {
            var text = new StringBuilder();
            Append(text, inlines, links, followable, false);
            return text.ToString();
        }

        /// <summary>
        /// Article text made inert for rich text: a zero-width space after every <c>&lt;</c> stops
        /// it opening a tag, and nothing else changes on screen.
        /// </summary>
        public static string Escape(string text) => string.IsNullOrEmpty(text) ? string.Empty : text.Replace("<", "<​");

        private static void Append(StringBuilder text, IEnumerable<HelpInline> inlines, List<HelpLinkTarget> links, Func<HelpLinkTarget, bool> followable, bool inLink)
        {
            foreach (HelpInline inline in inlines)
            {
                switch (inline.Kind)
                {
                    case HelpInlineKind.Text:
                    case HelpInlineKind.Term:
                        text.Append(Escape(inline.Text));
                        break;
                    case HelpInlineKind.Code:
                        text.Append("<b><color=").Append(CodeColor).Append('>').Append(Escape(inline.Text)).Append("</color></b>");
                        break;
                    case HelpInlineKind.Strong:
                        text.Append("<b>");
                        Append(text, inline.Children, links, followable, inLink);
                        text.Append("</b>");
                        break;
                    case HelpInlineKind.Em:
                        text.Append("<i>");
                        Append(text, inline.Children, links, followable, inLink);
                        text.Append("</i>");
                        break;
                    case HelpInlineKind.Link:
                        if (inLink || inline.Link == null || followable != null && !followable(inline.Link))
                        {
                            Append(text, inline.Children, links, followable, inLink);
                            break;
                        }
                        links.Add(inline.Link);
                        text.Append("<link=\"").Append(links.Count - 1).Append("\"><color=").Append(LinkColor).Append("><u>");
                        Append(text, inline.Children, links, followable, true);
                        text.Append("</u></color></link>");
                        break;
                }
            }
        }
    }

    /// <summary>What a rendered article can do with its links.</summary>
    public sealed class HelpRenderOptions
    {
        /// <summary>Whether a link can be followed here (an unbuilt screen, or any screen outside a game, is plain text).</summary>
        public Func<HelpLinkTarget, bool> Followable;
        /// <summary>Called when the reader clicks a link.</summary>
        public Action<HelpLinkTarget> Follow;
    }

    /// <summary>
    /// The article renderer (POL5-02): blocks to UI Toolkit elements on the design system. Headings
    /// get names <c>help-h-&lt;anchor&gt;</c> so a link or the contents can scroll to them.
    /// </summary>
    public static class HelpRenderer
    {
        public const string HeadingPrefix = "help-h-";

        public static VisualElement Render(IReadOnlyList<HelpBlock> blocks, HelpRenderOptions options)
        {
            VisualElement body = Ui.El("hp-body");
            foreach (HelpBlock block in blocks)
            {
                VisualElement element = Block(block, options);
                if (element != null) body.Add(element);
            }
            return body;
        }

        private static VisualElement Block(HelpBlock block, HelpRenderOptions options)
        {
            switch (block.Kind)
            {
                case HelpBlockKind.Heading:
                {
                    Label heading = Line(block.Inlines, options, block.Level == 2 ? "hp-h2" : "hp-h3");
                    heading.name = HeadingPrefix + block.Anchor;
                    return heading;
                }
                case HelpBlockKind.Paragraph:
                    return Line(block.Inlines, options, "hp-p");
                case HelpBlockKind.List:
                {
                    VisualElement list = Ui.El("hp-list");
                    for (int i = 0; i < block.Items.Count; i++)
                    {
                        VisualElement row = Ui.El("hp-list__item");
                        row.Add(Ui.Text(block.Ordered ? $"{i + 1}." : "•", "hp-list__marker"));
                        row.Add(Line(block.Items[i], options, "hp-list__text"));
                        list.Add(row);
                    }
                    return list;
                }
                case HelpBlockKind.Callout:
                {
                    bool tip = block.CalloutKind == "tip";
                    VisualElement callout = Ui.El("hp-callout", tip ? "hp-callout--tip" : "hp-callout--note", Ds.StateClass(tip ? DsState.Good : DsState.Info));
                    callout.Add(new Icon(tip ? "sparkles" : "info", "ds-icon--sm", "hp-callout__icon"));
                    VisualElement words = Ui.El("hp-callout__words");
                    words.Add(Ui.Text(tip ? "TIP" : "NOTE", "hp-callout__label"));
                    words.Add(Line(block.Inlines, options, "hp-p", "hp-callout__text"));
                    callout.Add(words);
                    return callout;
                }
                default:
                    // Directives (POL5-04's ::example-why) have no renderer yet: they draw nothing.
                    return null;
            }
        }

        private static Label Line(IEnumerable<HelpInline> inlines, HelpRenderOptions options, params string[] classes)
        {
            var links = new List<HelpLinkTarget>();
            string markup = HelpRichText.Markup(inlines, links, options?.Followable);
            Label label = Ui.Text(markup, classes);
            label.enableRichText = true;
            label.AddToClassList("hp-text");
            if (links.Count > 0 && options?.Follow != null)
            {
                label.RegisterCallback<PointerUpLinkTagEvent>(evt =>
                {
                    if (int.TryParse(evt.linkID, out int index) && index >= 0 && index < links.Count) options.Follow(links[index]);
                });
                label.RegisterCallback<PointerOverLinkTagEvent>(_ => label.AddToClassList("hp-text--over-link"));
                label.RegisterCallback<PointerOutLinkTagEvent>(_ => label.RemoveFromClassList("hp-text--over-link"));
            }
            return label;
        }
    }
}
