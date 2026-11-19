using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Why
{
    /// <summary>
    /// Shows the sample traces (<c>Assets/UI/Why/Samples</c>) as explained numbers, so the Why?
    /// panel can be checked before the engine bridge exists. Used by the demo scene
    /// (<c>Assets/UI/Why/WhyDemo.unity</c>) and the editor window (Ringside Booker → Why? panel
    /// samples). Each sample is shown twice: with its trace inline, and fetched "by reference"
    /// through a loader that answers a moment later, to show the loading state.
    ///
    /// Run the demo player with <c>-whyScreenshots &lt;folder&gt;</c> to write one PNG per sample
    /// with its panel open, then quit.
    /// </summary>
    public sealed class WhyDemo : MonoBehaviour
    {
        [SerializeField] private UIDocument document;
        [SerializeField] private PanelSettings panelSettings;
        [SerializeField] private TextAsset[] samples = Array.Empty<TextAsset>();

        /// <summary>The demo's panel settings (default runtime theme), in Resources.</summary>
        public const string PanelSettingsResource = "Why/WhyDemoPanelSettings";

        private readonly List<WhyButton> buttons = new List<WhyButton>();

        /// <summary>Builds the sample list into <paramref name="root"/> and returns the Why? buttons, one per sample.</summary>
        public static List<WhyButton> BuildSampleList(VisualElement root, IEnumerable<(string name, string json)> samples,
            Func<Action, IVisualElementScheduledItem> later = null)
        {
            WhyStyles.Apply(root);
            var page = new ScrollView(ScrollViewMode.Vertical);
            page.AddToClassList("why-demo");
            page.style.flexGrow = 1;
            page.style.paddingLeft = 24;
            page.style.paddingTop = 24;
            page.style.color = new Color(0.9f, 0.91f, 0.93f);
            root.Add(page);

            var heading = new Label("Why? panel samples");
            heading.style.fontSize = 20;
            heading.style.unityFontStyleAndWeight = FontStyle.Bold;
            heading.style.marginBottom = 12;
            page.Add(heading);

            WhyPanelHost.DefaultRoot = root;
            WhyPanelHost.DefaultLinks = new WhyLinks(entity => Debug.Log($"[WhyDemo] Open {entity.Kind} {entity.Id}"));

            var buttons = new List<WhyButton>();
            foreach ((string name, string json) in samples)
            {
                TraceEntry entry;
                try
                {
                    entry = TraceReader.ParseEntry(json);
                }
                catch (FormatException exception)
                {
                    page.Add(new Label($"{name}: could not read ({exception.Message})"));
                    continue;
                }
                string label = entry.IsFullTrace ? entry.Trace.Label : entry.Label;
                TraceValue value = entry.IsFullTrace ? entry.Trace.Value : entry.Value;
                string unit = entry.IsFullTrace ? entry.Trace.Unit : entry.Unit;

                var row = new VisualElement();
                row.style.flexDirection = FlexDirection.Row;
                row.style.alignItems = Align.Center;
                row.style.marginBottom = 8;
                var caption = new Label($"{name} — {label}");
                caption.style.width = 420;
                caption.style.whiteSpace = WhiteSpace.Normal;
                row.Add(caption);
                var inline = new WhyValue(label, value, WhySource.FromEntry(entry), unit);
                inline.Button.name = "why-" + name;
                buttons.Add(inline.Button);
                row.Add(inline);

                // The same trace "by reference": the loader answers a moment later, like an engine query.
                var byRef = WhySource.FromRef(entry.Ref ?? new TraceRef("sample", name), (traceRef, done) =>
                {
                    if (later == null) done(TraceLoadResult.FromEntry(entry));
                    else later(() => done(TraceLoadResult.FromEntry(entry)));
                });
                var lazy = new WhyButton(label, value, byRef, unit) { PanelTitle = label + " (by reference)" };
                lazy.style.marginLeft = 12;
                row.Add(lazy);
                page.Add(row);
            }
            return buttons;
        }

        private void OnEnable()
        {
            if (document == null) document = GetComponent<UIDocument>();
            if (document == null) return;
            // The scene's reference to the panel settings does not always survive a batch-mode save,
            // so fall back to the copy in Resources.
            if (panelSettings == null) panelSettings = Resources.Load<PanelSettings>(PanelSettingsResource);
            if (document.panelSettings == null && panelSettings != null) document.panelSettings = panelSettings;
            VisualElement root = document.rootVisualElement;
            root.Clear();
            var list = new List<(string, string)>();
            foreach (TextAsset sample in samples)
            {
                if (sample != null) list.Add((sample.name, sample.text));
            }
            buttons.Clear();
            buttons.AddRange(BuildSampleList(root, list, action => root.schedule.Execute(action).StartingIn(600)));
        }

        private void Start()
        {
            string folder = ScreenshotFolder();
            if (folder != null) StartCoroutine(TakeScreenshots(folder));
        }

        private static string ScreenshotFolder()
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int index = 0; index < args.Length - 1; index++)
            {
                if (args[index] == "-whyScreenshots") return args[index + 1];
            }
            return null;
        }

        /// <summary>Opens each sample's panel and saves what the panel draws, then quits.</summary>
        private IEnumerator TakeScreenshots(string folder)
        {
            Directory.CreateDirectory(folder);
            PanelSettings settings = document.panelSettings;
            var texture = new RenderTexture(1280, 800, 24, RenderTextureFormat.ARGB32);
            texture.Create();
            settings.targetTexture = texture;
            settings.clearColor = true;
            settings.colorClearValue = new Color(0.08f, 0.09f, 0.11f, 1f);
            for (int frame = 0; frame < 5; frame++) yield return null;
            yield return KeyboardCheck();

            foreach (WhyButton button in buttons)
            {
                button.OpenPanel();
                WhyPanel panel = button.OpenedPanel;
                for (int frame = 0; frame < 5; frame++) yield return null;
                Save(texture, Path.Combine(folder, button.name + ".png"));
                if (panel?.TraceView != null && panel.TraceView.HiddenCheckCount > 0)
                {
                    panel.TraceView.ExpandAll();
                    panel.TraceView.ShowAllChecks = true;
                    for (int frame = 0; frame < 5; frame++) yield return null;
                    Save(texture, Path.Combine(folder, button.name + "-all.png"));
                }
                Debug.Log($"[WhyDemo] {button.name}: {panel?.CopyText?.Split('\n')[0]}");
                panel?.Close();
            }
            Debug.Log("[WhyDemo] Screenshots done");
            Application.Quit(0);
        }

        /// <summary>
        /// Opens the first sample from the keyboard, moves down a row, closes with Esc and checks
        /// focus went back to the button. Logs "[WhyDemo] Keyboard check passed" or what failed.
        /// </summary>
        private IEnumerator KeyboardCheck()
        {
            if (buttons.Count == 0) yield break;
            WhyButton button = buttons[0];
            button.Focus();
            button.OpenPanel();
            WhyPanel panel = button.OpenedPanel;
            for (int frame = 0; frame < 3; frame++) yield return null;
            var failures = new List<string>();
            Focusable first = panel.focusController.focusedElement;
            if (!(first is VisualElement firstRow) || !panel.Contains(firstRow)) failures.Add("focus did not move into the panel");
            SendKey(panel, first, KeyCode.DownArrow);
            yield return null;
            Focusable second = panel.focusController.focusedElement;
            if (second == first) failures.Add("Down did not move to the next row");
            SendKey(panel, second, KeyCode.Escape);
            yield return null;
            if (!panel.IsClosed) failures.Add("Esc did not close the panel");
            if (button.focusController?.focusedElement != button) failures.Add("focus did not return to the button");
            Debug.Log(failures.Count == 0 ? "[WhyDemo] Keyboard check passed" : "[WhyDemo] Keyboard check FAILED: " + string.Join("; ", failures));
        }

        private static void SendKey(VisualElement panelElement, Focusable target, KeyCode key)
        {
            using (KeyDownEvent down = KeyDownEvent.GetPooled('\0', key, EventModifiers.None))
            {
                down.target = target;
                panelElement.panel.visualTree.SendEvent(down);
            }
        }

        private static void Save(RenderTexture texture, string path)
        {
            RenderTexture previous = RenderTexture.active;
            RenderTexture.active = texture;
            var image = new Texture2D(texture.width, texture.height, TextureFormat.RGB24, false);
            image.ReadPixels(new Rect(0, 0, texture.width, texture.height), 0, 0);
            image.Apply();
            RenderTexture.active = previous;
            File.WriteAllBytes(path, image.EncodeToPNG());
            Destroy(image);
        }
    }
}
