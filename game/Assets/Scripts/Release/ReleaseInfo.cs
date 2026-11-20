using System;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RingsideBooker.Release
{
    /// <summary>
    /// STUB written by the crash agent (Sprint 13) so the bug report and Send feedback can read the
    /// build's version before the versions agent (POL9-01/10) lands the real one. Same API as the
    /// shared contract: take the versions agent's file over this one at merge.
    /// Reads StreamingAssets/version.json (<c>{ version, channel, commit, built }</c>); without it,
    /// falls back to <see cref="Application.version"/> on the alpha channel.
    /// </summary>
    public static class ReleaseInfo
    {
        public const string FileName = "version.json";

        private static bool loaded;
        private static string version;
        private static string channel;
        private static string commit;
        private static string built;

        /// <summary>The full version, e.g. <c>0.1.0-alpha.3+1a2b3c4d</c>.</summary>
        public static string Version
        {
            get
            {
                Load();
                return version;
            }
        }

        /// <summary><c>alpha</c>, <c>beta</c> or <c>release</c>.</summary>
        public static string Channel
        {
            get
            {
                Load();
                return channel;
            }
        }

        public static bool IsAlpha => string.Equals(Channel, "alpha", StringComparison.OrdinalIgnoreCase);

        /// <summary>The commit the build came from, or null.</summary>
        public static string Commit
        {
            get
            {
                Load();
                return commit;
            }
        }

        /// <summary>When the build was made (ISO text), or null.</summary>
        public static string Built
        {
            get
            {
                Load();
                return built;
            }
        }

        /// <summary>Where the build's version.json lives.</summary>
        public static string FilePath => Path.Combine(Application.streamingAssetsPath, FileName);

        private static void Load()
        {
            if (loaded) return;
            loaded = true;
            version = Application.version;
            channel = "alpha";
            try
            {
                if (!File.Exists(FilePath)) return;
                JObject json = JObject.Parse(File.ReadAllText(FilePath));
                version = (string)json["version"] ?? version;
                channel = (string)json["channel"] ?? channel;
                commit = (string)json["commit"];
                built = (string)json["built"];
            }
            catch (Exception error)
            {
                Debug.LogWarning("[ReleaseInfo] could not read version.json: " + error.Message);
            }
        }
    }
}
