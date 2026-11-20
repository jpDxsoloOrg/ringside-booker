using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using UnityEngine;

namespace RingsideBooker.Help
{
    /// <summary>A group of articles on the Help index (index.json <c>sections</c>).</summary>
    public sealed class HelpSection
    {
        [JsonProperty("id")] public string Id;
        [JsonProperty("title")] public string Title;
        [JsonProperty("order")] public int Order;
    }

    /// <summary>One article's entry in index.json.</summary>
    public sealed class HelpArticleMeta
    {
        [JsonProperty("slug")] public string Slug;
        [JsonProperty("title")] public string Title;
        [JsonProperty("summary")] public string Summary;
        [JsonProperty("section")] public string Section;
        [JsonProperty("order")] public int Order;
        [JsonProperty("keywords")] public List<string> Keywords = new List<string>();
        /// <summary>The screens (nav item or screen ids) this article is about: their "?" opens it.</summary>
        [JsonProperty("screens")] public List<string> Screens = new List<string>();
    }

    /// <summary>index.json: <c>{ version: 1, sections: [...], articles: [...] }</c>.</summary>
    public sealed class HelpIndex
    {
        [JsonProperty("version")] public int Version;
        [JsonProperty("sections")] public List<HelpSection> Sections = new List<HelpSection>();
        [JsonProperty("articles")] public List<HelpArticleMeta> Articles = new List<HelpArticleMeta>();
    }

    /// <summary>An article ready to show: its entry, its parsed blocks and the source text.</summary>
    public sealed class HelpArticle
    {
        public HelpArticleMeta Meta;
        public List<HelpBlock> Blocks;
        public string Source;

        public IEnumerable<HelpBlock> Headings => Blocks.Where(block => block.Kind == HelpBlockKind.Heading);
    }

    /// <summary>
    /// The help content (POL5-01): <c>StreamingAssets/help/index.json</c> plus one Markdown file per
    /// article in <c>help/articles/&lt;slug&gt;.md</c>. Plain files shipped with the game, edited by
    /// changing a file (no editor screen). Loading never throws: a broken index or a missing file
    /// gives <see cref="Problem"/> or a null article, and the Help screen says so.
    /// </summary>
    public sealed class HelpLibrary
    {
        public const string FolderName = "help";

        private readonly Dictionary<string, HelpArticle> articles = new Dictionary<string, HelpArticle>();
        private readonly string folder;
        private HelpSearchIndex search;

        private static HelpLibrary shared;

        /// <summary>The game's help, loaded once from StreamingAssets.</summary>
        public static HelpLibrary Shared => shared ??= Load(Path.Combine(Application.streamingAssetsPath, FolderName));

        /// <summary>Forget the cached content (tests, a dev reload).</summary>
        public static void ResetShared() => shared = null;

        private HelpLibrary(string folder, HelpIndex index, string problem)
        {
            this.folder = folder;
            Index = index ?? new HelpIndex();
            Problem = problem;
        }

        /// <summary>The index (empty when it could not be read).</summary>
        public HelpIndex Index { get; }

        /// <summary>Why the index could not be read, or null.</summary>
        public string Problem { get; }

        public string Folder => folder;

        /// <summary>Reads index.json from <paramref name="folder"/>; articles load when first asked for.</summary>
        public static HelpLibrary Load(string folder)
        {
            string path = Path.Combine(folder ?? string.Empty, "index.json");
            try
            {
                if (!File.Exists(path)) return new HelpLibrary(folder, null, "The help files are missing from this build.");
                HelpIndex index = JsonConvert.DeserializeObject<HelpIndex>(File.ReadAllText(path));
                if (index == null || index.Version != 1) return new HelpLibrary(folder, null, "The help index could not be read.");
                index.Sections = index.Sections ?? new List<HelpSection>();
                index.Articles = (index.Articles ?? new List<HelpArticleMeta>()).Where(meta => meta != null).ToList();
                foreach (HelpArticleMeta meta in index.Articles)
                {
                    meta.Keywords ??= new List<string>();
                    meta.Screens ??= new List<string>();
                }
                return new HelpLibrary(folder, index, null);
            }
            catch (Exception exception) when (exception is IOException || exception is JsonException || exception is UnauthorizedAccessException)
            {
                return new HelpLibrary(folder, null, "The help index could not be read: " + exception.Message);
            }
        }

        /// <summary>Sections in order, each with its articles in order (empty sections left out).</summary>
        public IReadOnlyList<(HelpSection section, IReadOnlyList<HelpArticleMeta> articles)> Sections()
        {
            return Index.Sections.OrderBy(section => section.Order)
                .Select(section => (section, (IReadOnlyList<HelpArticleMeta>)Index.Articles.Where(meta => meta.Section == section.Id).OrderBy(meta => meta.Order).ToList()))
                .Where(pair => pair.Item2.Count > 0)
                .ToList();
        }

        public HelpArticleMeta Meta(string slug) => Index.Articles.FirstOrDefault(meta => meta.Slug == slug);

        public HelpSection SectionOf(HelpArticleMeta meta) => Index.Sections.FirstOrDefault(section => section.Id == meta?.Section);

        /// <summary>The article for a screen's "?" (the first whose <c>screens</c> names it), or null.</summary>
        public HelpArticleMeta ForScreen(string screenId)
        {
            if (string.IsNullOrEmpty(screenId)) return null;
            return Index.Articles.FirstOrDefault(meta => meta.Screens.Contains(screenId));
        }

        /// <summary>The article with its blocks, or null for an unknown slug or a missing file.</summary>
        public HelpArticle Article(string slug)
        {
            if (slug == null) return null;
            if (articles.TryGetValue(slug, out HelpArticle cached)) return cached;
            HelpArticleMeta meta = Meta(slug);
            string source = meta != null ? ReadArticleText(slug) : null;
            if (source == null) return null;
            var article = new HelpArticle { Meta = meta, Source = source, Blocks = HelpMarkdown.Parse(source) };
            articles[slug] = article;
            return article;
        }

        /// <summary>The raw Markdown of <c>articles/&lt;slug&gt;.md</c>, or null.</summary>
        public string ReadArticleText(string slug)
        {
            if (!HelpMarkdown.IsSlug(slug)) return null;
            string path = ArticlePath(slug);
            try
            {
                return File.Exists(path) ? File.ReadAllText(path) : null;
            }
            catch (Exception exception) when (exception is IOException || exception is UnauthorizedAccessException)
            {
                return null;
            }
        }

        public string ArticlePath(string slug) => Path.Combine(folder ?? string.Empty, "articles", slug + ".md");

        /// <summary>The search index over every article (built on first use).</summary>
        public HelpSearchIndex Search => search ??= HelpSearchIndex.Build(this);
    }
}
