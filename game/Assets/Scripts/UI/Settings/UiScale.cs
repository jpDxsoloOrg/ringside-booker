using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Settings
{
    /// <summary>
    /// Scales a UIDocument's panel to the window and the player's UI scale. The layout is designed for
    /// 1280×720 logical pixels: the panel scales with the screen (Shrink, so at least 1280×720 always
    /// fits at 100%), and the UI scale setting divides the reference size. Works on a runtime copy
    /// of the PanelSettings asset so play mode never edits the asset.
    /// </summary>
    [RequireComponent(typeof(UIDocument))]
    [DefaultExecutionOrder(-200)]
    public sealed class UiScale : MonoBehaviour
    {
        public static readonly Vector2Int ReferenceResolution = new Vector2Int(1280, 720);

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
            runtimeSettings.screenMatchMode = PanelScreenMatchMode.Shrink;
            runtimeSettings.referenceResolution = new Vector2Int(
                Mathf.RoundToInt(ReferenceResolution.x / scale),
                Mathf.RoundToInt(ReferenceResolution.y / scale));
        }
    }
}
