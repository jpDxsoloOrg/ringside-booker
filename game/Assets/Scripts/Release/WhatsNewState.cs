using System;
using UnityEngine;

namespace RingsideBooker.Release
{
    /// <summary>
    /// When the What's new sheet opens by itself (POL9-01): once per new version on this computer.
    /// The last version seen lives in PlayerPrefs (<see cref="Key"/>). The very first run records the
    /// version and stays closed (the welcome sheet greets new players); a different version opens the
    /// sheet once when it has something to say; the same version does nothing; a failed read never opens.
    /// </summary>
    public static class WhatsNewState
    {
        public const string Key = "rb.whatsNew.lastSeenVersion";

        public enum Decision
        {
            /// <summary>Do nothing.</summary>
            Stay,
            /// <summary>Remember this version without opening.</summary>
            Record,
            /// <summary>Open the sheet and remember this version.</summary>
            Open,
        }

        /// <summary>The pure rule. <paramref name="readOk"/> false = the stored value could not be read.</summary>
        public static Decision Decide(bool readOk, string lastSeen, string current, bool hasContent)
        {
            if (!readOk || string.IsNullOrEmpty(current)) return Decision.Stay;
            if (string.IsNullOrEmpty(lastSeen)) return Decision.Record;
            if (lastSeen == current) return Decision.Stay;
            return hasContent ? Decision.Open : Decision.Record;
        }

        /// <summary>Reads PlayerPrefs, decides for this build, and records it. True = open the sheet now.</summary>
        public static bool CheckOnStart(bool hasContent)
        {
            string current = ReleaseInfo.SemVer;
            bool readOk = true;
            string lastSeen = null;
            try
            {
                lastSeen = PlayerPrefs.GetString(Key, "");
            }
            catch (Exception error)
            {
                readOk = false;
                Debug.LogWarning($"[WhatsNew] Could not read {Key}: {error.Message}");
            }
            Decision decision = Decide(readOk, lastSeen, current, hasContent);
            if (decision != Decision.Stay) MarkSeen(current);
            return decision == Decision.Open;
        }

        /// <summary>
        /// True when the player was started with a dev switch (<c>-rb…</c>: screenshot tours, skip checks),
        /// so the sheet never covers what a tour is capturing.
        /// </summary>
        public static bool IsDevRun
        {
            get
            {
                foreach (string arg in Environment.GetCommandLineArgs())
                {
                    if (arg.StartsWith("-rb", StringComparison.Ordinal)) return true;
                }
                return false;
            }
        }

        public static void MarkSeen(string version)
        {
            try
            {
                PlayerPrefs.SetString(Key, version ?? "");
                PlayerPrefs.Save();
            }
            catch (Exception error)
            {
                Debug.LogWarning($"[WhatsNew] Could not save {Key}: {error.Message}");
            }
        }
    }
}
