namespace RingsideBooker.Saves
{
    /// <summary>
    /// The build that writes saves (POL9-10): its version and release channel, stamped into every
    /// slot header this build writes (<see cref="SaveSlotInfo.BuildVersion"/>,
    /// <see cref="SaveSlotInfo.BuildChannel"/>). The Saves assembly cannot see the game's
    /// <c>RingsideBooker.Release.ReleaseInfo</c>, so the game sets these at start-up
    /// (<c>UI/Saves/SaveBuildHook.cs</c>). Null when unknown (tests, tools).
    /// </summary>
    public static class SaveBuild
    {
        public const string ChannelAlpha = "alpha";

        private static volatile string version;
        private static volatile string channel;

        /// <summary>The full version, e.g. <c>0.1.0-alpha.3+1a2b3c4d</c>, or null.</summary>
        public static string Version => version;

        /// <summary><c>alpha</c>, <c>beta</c>, <c>release</c> or <c>local</c>, or null.</summary>
        public static string Channel => channel;

        /// <summary>Sets the stamp (main thread at start-up; tests).</summary>
        public static void Set(string buildVersion, string buildChannel)
        {
            version = string.IsNullOrWhiteSpace(buildVersion) ? null : buildVersion.Trim();
            channel = string.IsNullOrWhiteSpace(buildChannel) ? null : buildChannel.Trim().ToLowerInvariant();
        }
    }
}
