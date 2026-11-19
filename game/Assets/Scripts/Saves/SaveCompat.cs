using System;
using System.Linq;
using RingsideBooker.Engine;

namespace RingsideBooker.Saves
{
    /// <summary>
    /// "Made with an older build", as the web app decides it (engine <c>persistence/compat.ts</c>):
    /// a load that stopped while checking the data (validate, build, integrity) for a save whose
    /// schema fingerprint is not this build's. Any other failure is a real problem and keeps its
    /// detailed report; a save from a newer build keeps its own (version) message.
    /// </summary>
    public static class SaveCompat
    {
        /// <summary>The load stages at which a schema change shows up.</summary>
        public static readonly string[] GuardedStages = { "validate", "build", "integrity" };

        public const string OlderBuildTitle = "Made with an older build";

        public const string OlderBuildBody =
            "This save was made with an older build of Ringside Booker, and this build can't open it. " +
            "Start a new game. Export it first if you want to keep the file.";

        /// <summary>True when a load failure at <paramref name="stage"/> is explained by the build the save came from.</summary>
        /// <param name="savedFingerprint">The save header's fingerprint; null for saves from before fingerprints (counts as different).</param>
        public static bool IsOlderBuild(string stage, string savedFingerprint, string currentFingerprint)
        {
            return stage != null && GuardedStages.Contains(stage) && !string.Equals(savedFingerprint, currentFingerprint, StringComparison.Ordinal);
        }

        /// <summary>A hint for the list: the slot was written by a build with a different save schema (it may still load).</summary>
        public static bool FromOtherBuild(SaveSlotInfo slot, string currentFingerprint)
        {
            return slot != null && !slot.NeedsInspect && currentFingerprint != null
                && !string.Equals(slot.SchemaFingerprint, currentFingerprint, StringComparison.Ordinal);
        }

        /// <summary>"Copy details" text for a failed load (the web's report plus both fingerprints when older-build).</summary>
        public static string Report(string label, LoadResult failure, string savedFingerprint, string currentFingerprint, bool olderBuild)
        {
            string title = (olderBuild ? OlderBuildTitle : "Could not load") + ": " + label;
            string text = title + "\nStage: " + (failure?.Stage ?? "none") + "\n" + (failure?.ProblemText ?? string.Empty);
            if (olderBuild)
            {
                text += "\nSave schema: " + (savedFingerprint ?? "none") + "\nThis build's schema: " + currentFingerprint;
            }

            return text;
        }
    }
}
