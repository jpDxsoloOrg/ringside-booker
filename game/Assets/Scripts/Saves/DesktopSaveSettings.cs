using Newtonsoft.Json.Linq;

namespace RingsideBooker.Saves
{
    /// <summary>
    /// Desktop choices that differ from the web app because saves are files, not browser storage.
    /// See game/docs/saves.md ("History retention").
    /// </summary>
    public static class DesktopSaveSettings
    {
        public const string HistoryKeepDetailDaysKey = "history.keepDetailDays";

        /// <summary>
        /// Days of shows, cards, money rows and rival decisions kept in full (web: 28). 90 keeps a
        /// full quarter of detail for history screens and Why? panels; a year-old save grows from
        /// about 1.3 MB to 1.6 MB (measured, saves.md).
        /// </summary>
        public const int HistoryKeepDetailDays = 90;

        /// <summary>
        /// Adds the desktop tunables to a new-game input (<c>tunableOverrides</c>) unless the input
        /// already sets them. Returns the same object.
        /// </summary>
        public static JObject ApplyTo(JObject newGameOptions)
        {
            if (newGameOptions == null) return null;
            if (!(newGameOptions["tunableOverrides"] is JObject overrides))
            {
                overrides = new JObject();
                newGameOptions["tunableOverrides"] = overrides;
            }

            if (overrides[HistoryKeepDetailDaysKey] == null)
            {
                overrides[HistoryKeepDetailDaysKey] = HistoryKeepDetailDays;
            }

            return newGameOptions;
        }

        /// <summary>
        /// A quick default-world game (a founded promotion in California), used by the title screen
        /// until the new-game wizard (UNITY-09) exists, and by tests.
        /// </summary>
        public static JObject DefaultWorldGame(string saveName, string seed)
        {
            var options = new JObject
            {
                ["rootPackId"] = "default-world",
                ["seed"] = seed,
                ["playerName"] = "Alex Booker",
                ["saveName"] = saveName,
                ["seasonLength"] = new JObject { ["preset"] = "12m" },
                ["player"] = new JObject
                {
                    ["mode"] = "found",
                    ["name"] = "Golden State Wrestling",
                    ["shortName"] = "GSW",
                    ["homeRegionKey"] = "us-california",
                    ["style"] = "traditional",
                    ["size"] = "small",
                    ["color"] = "#335577",
                    ["starterKit"] = true,
                    ["weeklyShowDay"] = 3,
                },
                ["settings"] = new JObject(),
            };
            return ApplyTo(options);
        }
    }
}
