using System;
using System.Collections.Generic;
using System.Linq;
using RingsideBooker.Engine;

namespace RingsideBooker.UI.Crash
{
    /// <summary>
    /// The one-time notice after a load (UNITY-24, the web's LoadNoticeBanner): the save-format
    /// upgrades that ran on the save and anything the load worked around (for example settings this
    /// version no longer knows). The shell shows it as a quiet banner until it is dismissed or the
    /// next load replaces it.
    /// </summary>
    public sealed class LoadNotice
    {
        public LoadNotice(IEnumerable<string> upgrades, IEnumerable<string> warnings)
        {
            Upgrades = (upgrades ?? Enumerable.Empty<string>()).Where(text => !string.IsNullOrWhiteSpace(text)).ToList();
            Warnings = (warnings ?? Enumerable.Empty<string>()).Where(text => !string.IsNullOrWhiteSpace(text)).ToList();
        }

        /// <summary>The upgrades' titles, oldest first.</summary>
        public IReadOnlyList<string> Upgrades { get; }

        /// <summary>What the load changed, one line each (<c>path: message</c>, or the message alone).</summary>
        public IReadOnlyList<string> Warnings { get; }

        public bool IsEmpty => Upgrades.Count == 0 && Warnings.Count == 0;

        /// <summary>The banner's one line, in plain words.</summary>
        public string Headline => Upgrades.Count > 0
            ? "This save was upgraded to work with this version."
            : "This save loaded with a few changes.";

        /// <summary>The detail lines (one step away): the upgrades, then the changes.</summary>
        public IReadOnlyList<string> DetailLines
        {
            get
            {
                var lines = new List<string>();
                if (Upgrades.Count > 0) lines.Add("Upgraded this save: " + string.Join(", ", Upgrades) + ".");
                if (Warnings.Count > 0)
                {
                    lines.Add("The save loaded with these changes:");
                    lines.AddRange(Warnings.Select(warning => "• " + warning));
                }

                return lines;
            }
        }

        /// <summary>The notice a load result calls for, or null when the save loaded as it was.</summary>
        public static LoadNotice From(LoadResult load)
        {
            if (load == null || !load.Ok) return null;
            var notice = new LoadNotice(
                load.Summary?.MigrationsApplied?.Select(migration => migration?.Title),
                load.Warnings?.Select(warning => warning?.ToString()));
            return notice.IsEmpty ? null : notice;
        }

        // ---- The notice waiting for the shell ------------------------------------------------------

        /// <summary>The notice to show, or null.</summary>
        public static LoadNotice Pending { get; private set; }

        /// <summary>Raised when <see cref="Pending"/> changes.</summary>
        public static event Action Changed;

        /// <summary>After a load: replaces the notice (null clears it).</summary>
        public static void Show(LoadNotice notice)
        {
            Pending = notice;
            Changed?.Invoke();
        }

        /// <summary>After a load: the notice its result calls for (or none).</summary>
        public static void ShowFor(LoadResult load) => Show(From(load));

        public static void Dismiss() => Show(null);

        [UnityEngine.RuntimeInitializeOnLoadMethod(UnityEngine.RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Install()
        {
            Pending = null;
            // Back on the title screen the notice has had its chance: a new game must not inherit it.
            UnityEngine.SceneManagement.SceneManager.sceneLoaded += (scene, mode) =>
            {
                if (scene.name == SceneFlow.TitleScene && Pending != null) Dismiss();
            };
        }
    }
}
