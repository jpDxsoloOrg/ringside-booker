using System;
using System.Collections.Generic;
using System.Globalization;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RingsideBooker.UI.Bridge
{
    /// <summary>
    /// How far the player has read the news, for the sidebar's unread badge (UNITY-19). The engine
    /// keeps no read state for news (it is public, D-07), so the game remembers, per save slot, the
    /// day the player last had News open and how many stories that day held then. Unread = the
    /// stories from that day on (filler left out), less the ones already counted. Kept in PlayerPrefs
    /// (<c>rb.news.seen.&lt;slot id&gt;</c>), in memory when there is no save slot.
    /// </summary>
    public static class NewsSeen
    {
        /// <summary>Stories below this importance (filler) never count as unread, so the badge stays small.</summary>
        public const int MinImportance = 1;

        private const string PrefPrefix = "rb.news.seen.";
        private static readonly Dictionary<string, string> Memory = new Dictionary<string, string>();

        /// <summary>Raised when the player has read the news (the shell refreshes its badges).</summary>
        public static event Action Changed;

        private static string Key => Saves.GameSession.Current?.SlotId is string slot && slot.Length > 0 ? slot : "session";

        /// <summary>The seen day and its story count, or null before the player first opens News.</summary>
        public static (string date, int count)? Marker
        {
            get
            {
                string stored = null;
                try
                {
                    if (Key != "session") stored = PlayerPrefs.GetString(PrefPrefix + Key, null);
                }
                catch (Exception)
                {
                    stored = null;
                }
                if (string.IsNullOrEmpty(stored)) Memory.TryGetValue(Key, out stored);
                return Parse(stored);
            }
        }

        public static (string date, int count)? Parse(string stored)
        {
            if (string.IsNullOrEmpty(stored)) return null;
            int bar = stored.IndexOf('|');
            if (bar <= 0) return null;
            string date = stored.Substring(0, bar);
            if (!GameDate.TryParse(date, out _)) return null;
            return int.TryParse(stored.Substring(bar + 1), NumberStyles.Integer, CultureInfo.InvariantCulture, out int count) ? (date, count) : ((string, int)?)null;
        }

        /// <summary>Marks every story up to now as read: <paramref name="todayCount"/> stories (filler left out) are dated <paramref name="today"/>.</summary>
        public static void MarkRead(string today, int todayCount)
        {
            string value = $"{today}|{todayCount.ToString(CultureInfo.InvariantCulture)}";
            (string date, int count)? before = Marker;
            Memory[Key] = value;
            try
            {
                if (Key != "session") PlayerPrefs.SetString(PrefPrefix + Key, value);
            }
            catch (Exception)
            {
                // Memory still holds it.
            }
            if (before == null || before.Value.date != today || before.Value.count != todayCount) Changed?.Invoke();
        }

        /// <summary>The <c>news.feed</c> arguments that count the unread stories (only <c>total</c> is read).</summary>
        public static JObject CountArgs((string date, int count)? marker)
        {
            var args = new JObject { ["minImportance"] = MinImportance, ["limit"] = 1 };
            if (marker != null) args["from"] = marker.Value.date;
            return args;
        }

        /// <summary>The unread count from a <c>news.feed</c> total read with <see cref="CountArgs"/>.</summary>
        public static int Unread(int totalFromSeenDay, (string date, int count)? marker) =>
            Math.Max(0, totalFromSeenDay - Math.Max(0, marker?.count ?? 0));
    }
}
