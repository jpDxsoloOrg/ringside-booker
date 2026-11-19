using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Settings
{
    /// <summary>
    /// Scales a UIDocument's panel to the window and the player's UI scale. The layout is designed for
    /// 1920×1080 logical pixels at PC-game density, so 1080p renders 1:1; other windows scale with the
    /// screen (match width and height halfway: 1280×720 draws at 2/3, 4K at 2×), and the UI scale
    /// setting divides the reference size. Works on a runtime copy
    /// of the PanelSettings asset so play mode never edits the asset.
    /// </summary>
    [RequireComponent(typeof(UIDocument))]
    [DefaultExecutionOrder(-200)]
    public sealed class UiScale : MonoBehaviour
    {
        public static readonly Vector2Int ReferenceResolution = new Vector2Int(1920, 1080);

        /// <summary>How far the panel follows the window's height rather than its width (0 = width, 1 = height).</summary>
        public const float MatchWidthOrHeight = 0.5f;

        private PanelSettings runtimeSettings;

        private void Awake()
        {
            var document = GetComponent<UIDocument>();
            // Runs before the UIDocument enables (execution order), so it builds on the copy.
            PanelSettings source = document.panelSettings;
            if (source == null)
            {
                Debug.LogError($"[UiScale] {name} has no PanelSettings");
                return;
            }
            runtimeSettings = Instantiate(source);
            runtimeSettings.name = source.name + " (runtime)";
            Apply();
            document.panelSettings = runtimeSettings;
        }

        private void OnEnable() => UiSettings.Changed += Apply;

        private void OnDisable() => UiSettings.Changed -= Apply;

        private void OnDestroy()
        {
            if (runtimeSettings != null) Destroy(runtimeSettings);
        }

        private void Apply()
        {
            if (runtimeSettings == null) return;
            float scale = UiSettings.Scale;
            runtimeSettings.scaleMode = PanelScaleMode.ScaleWithScreenSize;
            runtimeSettings.screenMatchMode = PanelScreenMatchMode.MatchWidthOrHeight;
            runtimeSettings.match = MatchWidthOrHeight;
            runtimeSettings.referenceResolution = new Vector2Int(
                Mathf.RoundToInt(ReferenceResolution.x / scale),
                Mathf.RoundToInt(ReferenceResolution.y / scale));
        }
    }
}
