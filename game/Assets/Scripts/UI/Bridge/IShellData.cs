using System;
using System.Collections.Generic;

namespace RingsideBooker.UI.Bridge
{
    /// <summary>Counts a nav item can show in a badge (the web's <c>NavBadgeKey</c>).</summary>
    public enum NavBadgeKey
    {
        UnreadMail,
        PendingDecisions,
        WantsToLeave,
    }

    /// <summary>The promotion the player runs, for the sidebar's crest block.</summary>
    public sealed class PromotionInfo
    {
        public PromotionInfo(string id, string name, string shortName, string tagline, string logoRef = null)
        {
            Id = id;
            Name = name;
            ShortName = shortName;
            Tagline = tagline;
            LogoRef = logoRef;
        }

        /// <summary>The promotion's logo picture ref (a workshop world mod's <c>wm/...</c>), or null.</summary>
        public string LogoRef { get; }

        public string Id { get; }
        public string Name { get; }
        public string ShortName { get; }
        /// <summary>The line under the name, such as "Regional · Northeast". May be empty.</summary>
        public string Tagline { get; }
    }

    /// <summary>
    /// Everything the shell's chrome (sidebar, top bar status chips, nav badges) shows, as one
    /// immutable snapshot. The engine bridge builds a new one after every command or advance.
    /// </summary>
    public sealed class ShellSnapshot
    {
        private static readonly IReadOnlyDictionary<NavBadgeKey, int> NoBadges = new Dictionary<NavBadgeKey, int>();

        public ShellSnapshot(
            GameDate date,
            PromotionInfo promotion,
            long cashCents,
            string seasonLabel = null,
            int? popularity = null,
            int? prestige = null,
            IReadOnlyDictionary<NavBadgeKey, int> badges = null,
            string cashTraceRef = null,
            bool sample = false)
        {
            Date = date;
            Promotion = promotion;
            CashCents = cashCents;
            SeasonLabel = seasonLabel;
            Popularity = popularity;
            Prestige = prestige;
            Badges = badges ?? NoBadges;
            CashTraceRef = cashTraceRef;
            Sample = sample;
        }

        /// <summary>Today in the game.</summary>
        public GameDate Date { get; }
        /// <summary>The promotion the local player runs, or null while unemployed (promotion sections hide).</summary>
        public PromotionInfo Promotion { get; }
        public bool HasPromotion => Promotion != null;
        /// <summary>The promotion's cash in cents (the engine's unit). Ignored without a promotion.</summary>
        public long CashCents { get; }
        /// <summary>"Season 3 · Week 12", or null when the world has no season.</summary>
        public string SeasonLabel { get; }
        /// <summary>Popularity in the home region (0-100), or null to hide the chip.</summary>
        public int? Popularity { get; }
        public int? Prestige { get; }
        /// <summary>Badge counts by key; a missing key or zero shows no badge.</summary>
        public IReadOnlyDictionary<NavBadgeKey, int> Badges { get; }
        /// <summary>The engine's trace ref for the cash figure, for a Why? panel (UNITY-08), or null.</summary>
        public string CashTraceRef { get; }
        /// <summary>True when the data is the demo's, not a real game (shows a "Sample" badge).</summary>
        public bool Sample { get; }

        public int Badge(NavBadgeKey key) => Badges.TryGetValue(key, out int count) ? count : 0;
    }

    /// <summary>
    /// What the shell reads to draw its chrome. UNITY-04's engine bridge implements it over
    /// <c>sim.status</c> and the badge queries; <see cref="Demo.DemoGame"/> fakes it until then.
    /// <see cref="Changed"/> must be raised on Unity's main thread.
    /// </summary>
    public interface IShellData
    {
        ShellSnapshot Snapshot { get; }

        /// <summary>Raised (on the main thread) whenever <see cref="Snapshot"/> is replaced.</summary>
        event Action Changed;
    }

    /// <summary>
    /// Optional on an <see cref="IShellData"/>: the headlines the shell's news ticker shows (UNITY-11),
    /// newest first. Updated before <see cref="IShellData.Changed"/> is raised; empty hides the ticker.
    /// </summary>
    public interface IShellNews
    {
        IReadOnlyList<string> Headlines { get; }
    }
}
