using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace RingsideBooker.Help
{
    /// <summary>Where help progress is kept: PlayerPrefs in the game, a dictionary in tests.</summary>
    public interface IHelpPrefs
    {
        string Get(string key);
        void Set(string key, string value);
        void Delete(string key);
    }

    /// <summary>
    /// Help and first-run progress (POL5-05) is per machine and per save slot, never in the save:
    /// the welcome switch, the Alpha notice, and each game's Getting started checklist. Keys start
    /// with <c>rb.help.</c>; <see cref="ResetAll"/> clears them.
    /// </summary>
    public static class HelpPrefs
    {
        public const string WelcomeKey = "rb.help.welcome";
        public const string AlphaHiddenKey = "rb.help.alphaHidden";
        public const string AlphaSeenKey = "rb.help.alphaSeen";
        public const string SlotsKey = "rb.help.slots";
        public const string DonePrefix = "rb.help.checklist.";
        public const string HiddenPrefix = "rb.help.checklistHidden.";
        public const string CompletePrefix = "rb.help.checklistComplete.";

        /// <summary>The store (PlayerPrefs unless a test swaps it).</summary>
        public static IHelpPrefs Store { get; set; } = new PlayerPrefsStore();

        /// <summary>Show the welcome sheet after the new-game wizard ("Don't show this for new games" turns it off).</summary>
        public static bool WelcomeOn
        {
            get => Store.Get(WelcomeKey) != "never";
            set
            {
                if (value) Store.Delete(WelcomeKey);
                else Store.Set(WelcomeKey, "never");
            }
        }

        /// <summary>"Don't show the Alpha notice again".</summary>
        public static bool AlphaHidden
        {
            get => Store.Get(AlphaHiddenKey) == "1";
            set
            {
                if (value) Store.Set(AlphaHiddenKey, "1");
                else Store.Delete(AlphaHiddenKey);
            }
        }

        /// <summary>The Alpha notice has been shown on this machine at least once.</summary>
        public static bool AlphaSeen
        {
            get => Store.Get(AlphaSeenKey) == "1";
            set
            {
                if (value) Store.Set(AlphaSeenKey, "1");
                else Store.Delete(AlphaSeenKey);
            }
        }

        public static HashSet<string> Done(string slot) =>
            new HashSet<string>((Store.Get(DonePrefix + slot) ?? string.Empty).Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries));

        /// <summary>Marks a checklist item done for a slot; true when it was not done before. Done stays done.</summary>
        public static bool MarkDone(string slot, string itemId)
        {
            HashSet<string> done = Done(slot);
            if (!done.Add(itemId)) return false;
            Store.Set(DonePrefix + slot, string.Join(",", done.OrderBy(id => id, StringComparer.Ordinal)));
            RememberSlot(slot);
            return true;
        }

        public static bool ChecklistHidden(string slot) => Store.Get(HiddenPrefix + slot) == "1";

        public static void SetChecklistHidden(string slot, bool hidden)
        {
            if (hidden)
            {
                Store.Set(HiddenPrefix + slot, "1");
                RememberSlot(slot);
            }
            else
            {
                Store.Delete(HiddenPrefix + slot);
                Store.Delete(CompletePrefix + slot);
            }
        }

        /// <summary>The checklist was seen with every item done ("You're set"): it hides from the next visit on.</summary>
        public static bool ChecklistComplete(string slot) => Store.Get(CompletePrefix + slot) == "1";

        public static void SetChecklistComplete(string slot)
        {
            Store.Set(CompletePrefix + slot, "1");
            RememberSlot(slot);
        }

        /// <summary>Everything back to new: the welcome, the Alpha notice and every game's checklist.</summary>
        public static void ResetAll()
        {
            foreach (string slot in Slots())
            {
                Store.Delete(DonePrefix + slot);
                Store.Delete(HiddenPrefix + slot);
                Store.Delete(CompletePrefix + slot);
            }
            Store.Delete(SlotsKey);
            Store.Delete(WelcomeKey);
            Store.Delete(AlphaHiddenKey);
            Store.Delete(AlphaSeenKey);
        }

        private static IEnumerable<string> Slots() =>
            (Store.Get(SlotsKey) ?? string.Empty).Split(new[] { '|' }, StringSplitOptions.RemoveEmptyEntries);

        private static void RememberSlot(string slot)
        {
            List<string> slots = Slots().ToList();
            if (slots.Contains(slot)) return;
            slots.Add(slot);
            Store.Set(SlotsKey, string.Join("|", slots));
        }

        private sealed class PlayerPrefsStore : IHelpPrefs
        {
            public string Get(string key)
            {
                try
                {
                    return PlayerPrefs.HasKey(key) ? PlayerPrefs.GetString(key) : null;
                }
                catch (Exception)
                {
                    return null;
                }
            }

            public void Set(string key, string value)
            {
                try
                {
                    PlayerPrefs.SetString(key, value);
                    PlayerPrefs.Save();
                }
                catch (Exception)
                {
                    // Help progress is a convenience; the game works without it.
                }
            }

            public void Delete(string key)
            {
                try
                {
                    PlayerPrefs.DeleteKey(key);
                    PlayerPrefs.Save();
                }
                catch (Exception)
                {
                    // As above.
                }
            }
        }
    }

    /// <summary>A dictionary store for tests.</summary>
    public sealed class MemoryHelpPrefs : IHelpPrefs
    {
        public readonly Dictionary<string, string> Values = new Dictionary<string, string>();
        public string Get(string key) => Values.TryGetValue(key, out string value) ? value : null;
        public void Set(string key, string value) => Values[key] = value;
        public void Delete(string key) => Values.Remove(key);
    }
}
