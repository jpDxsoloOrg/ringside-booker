using System;
using UnityEngine;

namespace RingsideBooker.Saves
{
    /// <summary>
    /// Player settings for saves (UNITY-27): how many rotating backups each slot keeps. Stored in
    /// PlayerPrefs (<see cref="BackupsPerSlotKey"/>); read once on the main thread at start-up so the
    /// store can use it from the thread pool.
    /// </summary>
    public static class SaveSettings
    {
        public const string BackupsPerSlotKey = "rb.saves.backupsPerSlot";

        /// <summary>The default number of backups per slot.</summary>
        public const int DefaultBackupsPerSlot = 5;

        public const int MinBackupsPerSlot = 1;

        public const int MaxBackupsPerSlot = 20;

        /// <summary>The choices the Settings screen offers.</summary>
        public static readonly int[] BackupChoices = { 1, 3, 5, 10 };

        private static volatile int backupsPerSlot = DefaultBackupsPerSlot;

        /// <summary>How many backups each slot keeps (oldest go first). Set on the main thread.</summary>
        public static int BackupsPerSlot
        {
            get => backupsPerSlot;
            set
            {
                backupsPerSlot = Clamp(value);
                PlayerPrefs.SetInt(BackupsPerSlotKey, backupsPerSlot);
                PlayerPrefs.Save();
                Changed?.Invoke();
            }
        }

        /// <summary>Raised on the main thread after <see cref="BackupsPerSlot"/> changes.</summary>
        public static event Action Changed;

        public static int Clamp(int value) => Math.Max(MinBackupsPerSlot, Math.Min(MaxBackupsPerSlot, value));

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Load()
        {
            backupsPerSlot = Clamp(PlayerPrefs.GetInt(BackupsPerSlotKey, DefaultBackupsPerSlot));
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            Changed = null;
        }
    }
}
