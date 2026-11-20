// Minimal stand-ins for two Sprint 13 contracts owned by other agents, so the help agent's welcome
// sheet compiles before they land:
//   - RingsideBooker.Release.ReleaseInfo (the versions agent, POL9-01/10)
//   - RingsideBooker.Diagnostics.Feedback (the crash agent, POL1-02)
// When their real files are merged, DELETE THIS FILE (the real types replace these with the same API).
using System;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RingsideBooker.Release
{
    /// <summary>Stub of the versions agent's ReleaseInfo: reads StreamingAssets/version.json when present.</summary>
    public static class ReleaseInfo
    {
        private static JObject info;
        private static bool read;

        private static JObject Info
        {
            get
            {
                if (read) return info;
                read = true;
                try
                {
                    string path = Path.Combine(Application.streamingAssetsPath, "version.json");
                    if (File.Exists(path)) info = JObject.Parse(File.ReadAllText(path));
                }
                catch (Exception exception)
                {
                    Debug.LogWarning($"[ReleaseInfo] version.json: {exception.Message}");
                }
                return info;
            }
        }

        public static string Version => (string)Info?["version"] ?? Application.version;

        /// <summary>alpha, beta or release; "alpha" until version.json says otherwise (the Alpha is the current channel).</summary>
        public static string Channel => (string)Info?["channel"] ?? "alpha";

        public static bool IsAlpha => string.Equals(Channel, "alpha", StringComparison.OrdinalIgnoreCase);

        public static string Commit => (string)Info?["commit"];
    }
}

namespace RingsideBooker.Diagnostics
{
    /// <summary>Stub of the crash agent's Feedback.Send(): the real one builds the bug-report zip and opens a mail draft.</summary>
    public static class Feedback
    {
        public static void Send()
        {
            Debug.Log("[Feedback] Send feedback (stub until POL1-02 lands)");
            string subject = Uri.EscapeDataString($"Ringside Booker Alpha {Release.ReleaseInfo.Version} feedback");
            Application.OpenURL($"mailto:feedback@example.invalid?subject={subject}");
        }
    }
}
