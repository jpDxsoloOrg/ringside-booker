using System;
using UnityEngine;

namespace RingsideBooker.UI.Settings
{
    /// <summary>
    /// Player UI preferences, kept in PlayerPrefs. The UI scale multiplies the panel's own scaling
    /// (the layout is designed at 1280×720 and scales with the window up to 4K).
    /// </summary>
    public static class UiSettings
    {
        public const string ScaleKey = "rb.ui.scale";
        public const float MinScale = 0.75f;
        public const float MaxScale = 2f;

        /// <summary>The choices the Settings screen offers.</summary>
        public static readonly float[] ScalePresets = { 0.8f, 0.9f, 1f, 1.1f, 1.25f, 1.5f, 1.75f, 2f };

        /// <summary>Raised after <see cref="Scale"/> changes.</summary>
        public static event Action Changed;

        /// <summary>The UI scale, 1 = 100%.</summary>
        public static float Scale
        {
            get => Mathf.Clamp(PlayerPrefs.GetFloat(ScaleKey, 1f), MinScale, MaxScale);
            set
            {
                float clamped = Mathf.Clamp(value, MinScale, MaxScale);
                if (Mathf.Approximately(clamped, Scale)) return;
                PlayerPrefs.SetFloat(ScaleKey, clamped);
                PlayerPrefs.Save();
                Changed?.Invoke();
            }
        }

        public static string Percent(float scale) => $"{Mathf.RoundToInt(scale * 100)}%";
    }
}
