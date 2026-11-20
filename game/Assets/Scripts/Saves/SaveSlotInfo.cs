using System;
using System.Globalization;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RingsideBooker.Saves
{
    /// <summary>
    /// One save slot as the load list shows it, without loading the world: the save's header (the
    /// same fields <c>inspectSave</c> reads) plus what the store knows about the file. Kept next to
    /// the save as <c>&lt;slot&gt;.json</c>; rebuilt from the save with <c>inspectSave</c> when missing.
    /// </summary>
    public sealed class SaveSlotInfo
    {
        /// <summary>The sidecar's own format.</summary>
        public const int CurrentIndexVersion = 1;

        public int IndexVersion { get; set; } = CurrentIndexVersion;

        /// <summary>The file name without extension; stable for the slot's life.</summary>
        public string SlotId { get; set; }

        /// <summary>The slot's name (the save header's label).</summary>
        public string Label { get; set; }

        public string WorldName { get; set; }

        /// <summary>The player's promotion, or null (unemployed, sandbox).</summary>
        public string PromotionName { get; set; }

        public string PromotionShortName { get; set; }

        /// <summary>The game date, <c>YYYY-MM-DD</c>.</summary>
        public string GameDate { get; set; }

        public string StartDate { get; set; }

        public int DaysSimulated { get; set; }

        /// <summary>The promotion's cash in cents, or null.</summary>
        public long? Cash { get; set; }

        /// <summary>The real time the slot was last written (UTC).</summary>
        public DateTimeOffset SavedAt { get; set; }

        /// <summary>The engine build that wrote the save (null when unknown).</summary>
        public string EngineVersion { get; set; }

        /// <summary>The save schema fingerprint of that build (null for saves from before fingerprints).</summary>
        public string SchemaFingerprint { get; set; }

        public int FormatVersion { get; set; }

        /// <summary>The game build that wrote this slot (POL9-10), e.g. <c>0.1.0-alpha.3+1a2b3c4d</c>; null when unknown (imported, or older builds).</summary>
        public string BuildVersion { get; set; }

        /// <summary>That build's release channel (<c>alpha</c>, <c>beta</c>, <c>release</c>, <c>local</c>); null when unknown.</summary>
        public string BuildChannel { get; set; }

        /// <summary>True when an Alpha build wrote the save (the Load list tags it).</summary>
        [JsonIgnore]
        public bool MadeByAlpha => string.Equals(BuildChannel, SaveBuild.ChannelAlpha, StringComparison.Ordinal);

        /// <summary>The save file's size in bytes.</summary>
        public long SizeBytes { get; set; }

        /// <summary>True when at least one earlier save is kept as a backup (<see cref="SaveStore.ListBackups"/>).</summary>
        [JsonIgnore]
        public bool HasBackup => BackupCount > 0;

        /// <summary>How many backups the slot keeps right now.</summary>
        [JsonIgnore]
        public int BackupCount { get; set; }

        /// <summary>True when no readable sidecar exists yet (a file dropped into the folder); <see cref="SaveStore.ListAsync"/> repairs it.</summary>
        [JsonIgnore]
        public bool NeedsInspect { get; set; }

        /// <summary>"Promotion · date" for the list (no promotion: "Unemployed").</summary>
        [JsonIgnore]
        public string Subtitle
        {
            get
            {
                string who = PromotionName ?? (NeedsInspect ? "Not read yet" : "No promotion");
                return GameDate == null ? who : who + " · " + GameDate;
            }
        }

        /// <summary>Copies the header fields of a <c>SaveHeader</c> (from <c>save()</c> or <c>inspectSave()</c>).</summary>
        public void ApplyHeader(JToken header)
        {
            if (header == null || header.Type != JTokenType.Object) return;
            Label = Text(header, "label") ?? Label;
            WorldName = Text(header, "worldName");
            PromotionName = Text(header, "promotionName");
            PromotionShortName = Text(header, "promotionShortName");
            GameDate = Text(header, "gameDate");
            StartDate = Text(header, "startDate");
            DaysSimulated = header.Value<int?>("daysSimulated") ?? 0;
            Cash = header.Value<long?>("cash");
            SchemaFingerprint = Text(header, "schemaFingerprint");
        }

        /// <summary>A copy (the store keeps a backup's header this way).</summary>
        public SaveSlotInfo Clone() => (SaveSlotInfo)MemberwiseClone();

        /// <summary>The saved time in the player's local time, for the list.</summary>
        public string SavedAtText()
        {
            return SavedAt == default
                ? "Unknown"
                : SavedAt.ToLocalTime().ToString("d MMM yyyy, HH:mm", CultureInfo.InvariantCulture);
        }

        /// <summary>The file size as "1.3 MB" / "820 KB".</summary>
        public string SizeText()
        {
            if (SizeBytes >= 1024 * 1024) return (SizeBytes / (1024.0 * 1024.0)).ToString("0.0", CultureInfo.InvariantCulture) + " MB";
            return Math.Max(1, SizeBytes / 1024).ToString(CultureInfo.InvariantCulture) + " KB";
        }

        private static string Text(JToken token, string key)
        {
            JToken value = token[key];
            return value == null || value.Type == JTokenType.Null ? null : value.Value<string>();
        }
    }
}
