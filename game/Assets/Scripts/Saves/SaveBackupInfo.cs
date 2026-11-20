using System;

namespace RingsideBooker.Saves
{
    /// <summary>
    /// One rotating backup of a slot (UNITY-27): an earlier save of the slot, kept as
    /// <c>Saves/Backups/&lt;slot&gt;/&lt;backup id&gt;.rbsave</c> with its header next to it
    /// (<c>&lt;backup id&gt;.json</c>, the slot header it had when it was the current save).
    /// </summary>
    public sealed class SaveBackupInfo
    {
        /// <summary>The file name without extension: the UTC time it became a backup, <c>20261119-142233-123</c>; sorts oldest first.</summary>
        public string BackupId { get; internal set; }

        public string SlotId { get; internal set; }

        /// <summary>The header it had as the slot's save (label, game date, saved time…); never null.</summary>
        public SaveSlotInfo Info { get; internal set; }

        /// <summary>The backup file's size in bytes.</summary>
        public long SizeBytes => Info.SizeBytes;

        /// <summary>The real time the save was written (UTC).</summary>
        public DateTimeOffset SavedAt => Info.SavedAt;

        /// <summary>The game date it holds (<c>YYYY-MM-DD</c>), or null when its header was lost.</summary>
        public string GameDate => Info.GameDate;

        /// <summary>True when no header was kept (an old <c>.bak</c>, or a crash between writes); <see cref="SaveStore.ListBackupsAsync"/> repairs it.</summary>
        public bool NeedsInspect => Info.NeedsInspect;
    }
}
