using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using NUnit.Framework;
using RingsideBooker.Help;
using RingsideBooker.UI.Navigation;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Tests.Help
{
    /// <summary>The help content check, the Markdown subset and its safe rich text, search, and the Help view (POL5-01/02).</summary>
    public sealed class HelpTests
    {
        private static string ShippedFolder => Path.Combine(Application.streamingAssetsPath, HelpLibrary.FolderName);

        private static HelpLibrary Shipped() => HelpLibrary.Load(ShippedFolder);

        private string temp;

        [SetUp]
        public void SetUp()
        {
            HelpLibrary.ResetShared();
            temp = null;
        }

        [TearDown]
        public void TearDown()
        {
            if (temp != null && Directory.Exists(temp)) Directory.Delete(temp, true);
            HelpLibrary.ResetShared();
        }

        // ---- Content check -----------------------------------------------------------------------------

        [Test]
        public void ShippedContentPassesTheCheck()
        {
            HelpLibrary library = Shipped();
            List<string> problems = HelpContentCheck.Run(library, HelpScreen.KnownScreenIds());
            Assert.IsEmpty(problems, string.Join("\n", problems));
            Assert.That(library.Index.Articles.Count, Is.InRange(6, 8), "the Alpha ships 6 to 8 articles");
        }

        [Test]
        public void ShippedArticlesCoverTheMainScreens()
        {
            HelpLibrary library = Shipped();
            foreach (string screen in new[] { "dashboard", "roster", "booking", ScreenIds.ShowNight, "contracts", "finances" })
            {
                Assert.IsNotNull(library.ForScreen(screen), $"no article for {screen}");
            }
            Assert.IsNotNull(library.Meta("why-panels"), "the Why? panel has an article");
        }

        [Test]
        public void TheCheckCatchesBrokenContent()
        {
            temp = Path.Combine(Path.GetTempPath(), "rb-help-check-" + System.Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path.Combine(temp, "articles"));
            File.WriteAllText(Path.Combine(temp, "index.json"), @"{ ""version"": 1,
                ""sections"": [ { ""id"": ""a"", ""title"": ""A"", ""order"": 1 }, { ""id"": ""empty"", ""title"": ""E"", ""order"": 2 } ],
                ""articles"": [
                  { ""slug"": ""one"", ""title"": ""One"", ""summary"": ""S"", ""section"": ""a"", ""order"": 1, ""keywords"": [], ""screens"": [""nowhere""] },
                  { ""slug"": ""missing"", ""title"": ""Two"", ""summary"": ""S"", ""section"": ""b"", ""order"": 2, ""keywords"": [] } ] }");
            File.WriteAllText(Path.Combine(temp, "articles", "one.md"),
                "## Hello\n\nA match lasts 12 minutes.\n\n<script>alert(1)</script>\n\nSee [this](help:nope), [there](help:one#nowhere) and [that](screen:nowhere).\n\n::mystery\n");
            File.WriteAllText(Path.Combine(temp, "articles", "orphan.md"), "## Orphan\n");

            List<string> problems = HelpContentCheck.Run(HelpLibrary.Load(temp), HelpScreen.KnownScreenIds());
            string all = string.Join("\n", problems);
            StringAssert.Contains("unknown screen \"nowhere\"", all);
            StringAssert.Contains("unknown section \"b\"", all);
            StringAssert.Contains("section \"empty\" has no articles", all);
            StringAssert.Contains("articles/missing.md: the file is missing", all);
            StringAssert.Contains("articles/orphan.md has no entry", all);
            StringAssert.Contains("one.md:3: mentions minutes", all);
            StringAssert.Contains("one.md:5: raw HTML", all);
            StringAssert.Contains("help:nope goes to an unknown article", all);
            StringAssert.Contains("help:one#nowhere goes to an unknown heading", all);
            StringAssert.Contains("screen:nowhere goes to an unknown screen", all);
            StringAssert.Contains("unknown directive ::mystery", all);
        }

        [Test]
        public void AMissingIndexIsAProblemNotACrash()
        {
            HelpLibrary library = HelpLibrary.Load(Path.Combine(Path.GetTempPath(), "rb-help-none-" + System.Guid.NewGuid().ToString("N")));
            Assert.IsNotNull(library.Problem);
            Assert.IsNull(library.Article("anything"));
            Assert.IsNotEmpty(HelpContentCheck.Run(library, new HashSet<string>()));
        }

        // ---- Parser ---------------------------------------------------------------------------------------

        [Test]
        public void ParsesEveryBlock()
        {
            List<HelpBlock> blocks = HelpMarkdown.Parse(
                "Intro line\nwraps here.\n\n## First part\n\n- one\n- two\n  more\n\n1. a\n2. b\n\n> **Tip:** Do it.\n\n> **Note:** Mind it.\n\n### Small {#tiny}\n\n::example-why\n");
            Assert.AreEqual(new[] { HelpBlockKind.Paragraph, HelpBlockKind.Heading, HelpBlockKind.List, HelpBlockKind.List, HelpBlockKind.Callout, HelpBlockKind.Callout, HelpBlockKind.Heading, HelpBlockKind.Directive },
                blocks.Select(block => block.Kind).ToArray());
            Assert.AreEqual("Intro line wraps here.", HelpMarkdown.PlainText(blocks[0].Inlines));
            Assert.AreEqual("first-part", blocks[1].Anchor);
            Assert.AreEqual(2, blocks[1].Level);
            Assert.IsFalse(blocks[2].Ordered);
            Assert.AreEqual("two more", HelpMarkdown.PlainText(blocks[2].Items[1]));
            Assert.IsTrue(blocks[3].Ordered);
            Assert.AreEqual("tip", blocks[4].CalloutKind);
            Assert.AreEqual("Do it.", HelpMarkdown.PlainText(blocks[4].Inlines));
            Assert.AreEqual("note", blocks[5].CalloutKind);
            Assert.AreEqual("tiny", blocks[6].Anchor);
            Assert.AreEqual(3, blocks[6].Level);
            Assert.AreEqual("example-why", blocks[7].Name);
        }

        [Test]
        public void ParsesEveryRun()
        {
            List<HelpInline> runs = HelpMarkdown.ParseInlines("a **b** *c* _d_ `Shift+N` [[push|the push]] [**Go**](screen:roster) [x](help:roster#setting-a-push) [w](https://example.com)");
            HelpInlineKind[] kinds = runs.Where(run => !(run.Kind == HelpInlineKind.Text && string.IsNullOrWhiteSpace(run.Text))).Select(run => run.Kind).ToArray();
            Assert.AreEqual(new[] { HelpInlineKind.Text, HelpInlineKind.Strong, HelpInlineKind.Em, HelpInlineKind.Em, HelpInlineKind.Code, HelpInlineKind.Term,
                HelpInlineKind.Link, HelpInlineKind.Link, HelpInlineKind.Link }, kinds);
            HelpInline screen = runs.First(run => run.Kind == HelpInlineKind.Link);
            Assert.AreEqual(HelpLinkKind.Screen, screen.Link.Kind);
            Assert.AreEqual("roster", screen.Link.ScreenId);
            Assert.AreEqual(HelpInlineKind.Strong, screen.Children[0].Kind, "bold inside a link");
            HelpInline help = runs.Where(run => run.Kind == HelpInlineKind.Link).ElementAt(1);
            Assert.AreEqual("roster", help.Link.Slug);
            Assert.AreEqual("setting-a-push", help.Link.Anchor);
            Assert.AreEqual(HelpLinkKind.External, runs.Last(run => run.Kind == HelpInlineKind.Link).Link.Kind);
            HelpInline term = runs.First(run => run.Kind == HelpInlineKind.Term);
            Assert.AreEqual("push", term.TermId);
            Assert.AreEqual("the push", term.Text);
        }

        [Test]
        public void UnclosedMarkersAndSnakeCaseStayText()
        {
            Assert.AreEqual("a **b and *c and `d", HelpMarkdown.PlainText(HelpMarkdown.ParseInlines("a **b and *c and `d")));
            List<HelpInline> runs = HelpMarkdown.ParseInlines("snake_case_word");
            Assert.AreEqual(1, runs.Count);
            Assert.AreEqual(HelpInlineKind.Text, runs[0].Kind);
            Assert.AreEqual("a*b", HelpMarkdown.PlainText(HelpMarkdown.ParseInlines(@"a\*b")));
        }

        [Test]
        public void UnsafeLinksBecomeTheirWords()
        {
            foreach (string target in new[] { "javascript:alert(1)", "data:text/html,hi", "http://example.com", "help:Not A Slug", "file:///c:/x" })
            {
                List<HelpInline> runs = HelpMarkdown.ParseInlines($"[click]({target})");
                Assert.IsTrue(runs.All(run => run.Kind != HelpInlineKind.Link), target);
                Assert.AreEqual("click", HelpMarkdown.PlainText(runs), target);
            }
        }

        [Test]
        public void HeadingsGetAnchorsAndRepeatsAreNumbered()
        {
            List<HelpBlock> blocks = HelpMarkdown.Parse("## What's on the Office?\n\n## Keys\n\n## Keys\n\n## Keys\n\n## Café **now**\n");
            Assert.AreEqual(new[] { "whats-on-the-office", "keys", "keys-2", "keys-3", "cafe-now" }, blocks.Select(block => block.Anchor).ToArray());
        }

        [Test]
        public void ALongInputParsesQuickly()
        {
            var text = new StringBuilder();
            for (int i = 0; i < 5000; i++)
            {
                text.Append(i % 7 == 0 ? "## Heading " + i : i % 5 == 0 ? "- item **bold** [x](help:a) _em_" : "Some *words* with `code` and [[term]] and ** unclosed [ ( _").Append('\n');
            }
            HelpMarkdown.Parse(text.ToString());
            var clock = Stopwatch.StartNew();
            HelpMarkdown.Parse(text.ToString());
            clock.Stop();
            Assert.Less(clock.ElapsedMilliseconds, 200, "5,000 lines should parse in well under a fifth of a second");
        }

        // ---- Safe rich text ------------------------------------------------------------------------------

        [Test]
        public void ArticleTextNeverMakesATag()
        {
            List<HelpInline> runs = HelpMarkdown.ParseInlines("<script>alert(1)</script> <color=red>x</color> **<b>bold</b>**");
            string markup = HelpRichText.Markup(runs, new List<HelpLinkTarget>(), null);
            // Every "<" from the article is followed by a zero-width space, so none opens a tag.
            Assert.IsFalse(markup.Contains("<script"));
            Assert.IsFalse(markup.Contains("<color=red"));
            Assert.IsFalse(markup.Contains("<b>bold"));
            StringAssert.Contains("<\u200Bscript>", markup);
            StringAssert.StartsWith("<\u200Bscript>", markup);
        }

        [Test]
        public void LinksBecomeLinkTagsOnlyWhenFollowable()
        {
            List<HelpInline> runs = HelpMarkdown.ParseInlines("Go to [Roster](screen:roster) or [Help](help:roster).");
            var links = new List<HelpLinkTarget>();
            string markup = HelpRichText.Markup(runs, links, link => link.Kind == HelpLinkKind.Help);
            Assert.AreEqual(1, links.Count);
            Assert.AreEqual("roster", links[0].Slug);
            StringAssert.Contains("<link=\"0\">", markup);
            StringAssert.Contains("Go to Roster or ", markup);
        }

        // ---- Library and search ---------------------------------------------------------------------------

        [Test]
        public void ScreensFindTheirArticle()
        {
            HelpLibrary library = Shipped();
            Assert.AreEqual("the-office", library.ForScreen("dashboard").Slug);
            Assert.AreEqual("show-night", library.ForScreen(ScreenIds.ShowResults).Slug);
            Assert.IsNull(library.ForScreen("inbox"), "a placeholder screen has no \"?\"");
            Assert.IsNull(library.Article("no-such-article"));
        }

        [Test]
        public void SearchingSaveFindsSavingFirst()
        {
            HelpSearchIndex search = Shipped().Search;
            List<HelpSearchResult> results = search.Find("save");
            Assert.IsNotEmpty(results);
            Assert.AreEqual("getting-started", results[0].Slug);
            Assert.AreEqual("getting-started", search.Find("SAV")[0].Slug, "prefix and case-insensitive");
            Assert.AreEqual("finances", search.Find("ledger")[0].Slug);
            Assert.IsEmpty(search.Find("zzzzqq"));
            Assert.IsEmpty(search.Find("  "));
            Assert.IsEmpty(search.Find("ledger zzzzqq"), "every word must match");
        }

        // ---- The Help view ----------------------------------------------------------------------------------

        [Test]
        public void TheIndexListsTheSections()
        {
            HelpView view = HelpScreen.BuildOutOfGame();
            foreach (string section in new[] { "basics", "promotion", "business" })
            {
                Assert.IsNotNull(view.Root.Q<VisualElement>("help-section-" + section), section);
            }
            Assert.IsNotNull(view.Root.Q<Button>("help-card-booking"));
        }

        [Test]
        public void AnArticleShowsItsContents()
        {
            HelpView view = HelpScreen.BuildOutOfGame(new HelpLocation { Slug = "getting-started" });
            Assert.AreEqual("getting-started", view.ShownSlug);
            Assert.IsNotNull(view.Root.Q<VisualElement>("help-toc"));
            Assert.IsNotNull(view.Root.Q<Button>("help-toc-saving"));
            Assert.IsNotNull(view.Root.Q<VisualElement>(HelpRenderer.HeadingPrefix + "saving"));
        }

        [Test]
        public void AnUnknownSlugShowsArticleNotFound()
        {
            HelpView view = HelpScreen.BuildOutOfGame(new HelpLocation { Slug = "nope" });
            Assert.IsNull(view.ShownSlug);
            Assert.IsNotNull(view.Root.Q<VisualElement>("help-not-found"));
        }

        [Test]
        public void SearchRedrawsTheList()
        {
            HelpView view = HelpScreen.BuildOutOfGame();
            view.Search("save");
            Assert.AreEqual("getting-started", view.Results[0].Slug);
            Assert.IsNotNull(view.Root.Q<Button>("help-result-getting-started"));
            view.Search("zzzzqq");
            Assert.IsNotNull(view.Root.Q<Label>("help-no-results"));
            view.Search(string.Empty);
            Assert.IsNotNull(view.Root.Q<Button>("help-item-roster"));
        }

        [Test]
        public void OutOfGameScreenLinksArePlainText()
        {
            HelpView view = HelpScreen.BuildOutOfGame(new HelpLocation { Slug = "getting-started" });
            List<string> texts = view.Root.Query<Label>(className: "hp-text").ToList().Select(label => label.text).ToList();
            string booking = texts.First(text => text.Contains("and fill your next show"));
            Assert.IsFalse(booking.Contains("<link"), "screen:booking is plain text outside a game");
            string office = texts.First(text => text.Contains("Start on the"));
            StringAssert.Contains("<link=", office, "help: links still work");
        }

        [Test]
        public void HelpIsTheLastSidebarSection()
        {
            Assert.AreEqual("help", NavigationModel.Sections.Last().Id);
            Assert.IsFalse(NavigationModel.Sections.Last().RequiresPromotion);
            List<string> ids = NavigationModel.Sections.SelectMany(section => section.Items).Select(item => item.Id).ToList();
            Assert.AreEqual(ids.Count, ids.Distinct().Count());
        }
    }
}
