using System.IO;
using System.Linq;
using RingsideBooker.UI.Why;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Why.EditorTools
{
    /// <summary>
    /// Ringside Booker → Why? panel samples: the sample traces as explained numbers, each opening
    /// the Why? panel, inside the editor (no play mode, no engine). Also builds the demo scene and
    /// a demo player that screenshots every sample's panel (batch mode: <see cref="BuildDemoPlayer"/>).
    /// </summary>
    public sealed class WhySamplesWindow : EditorWindow
    {
        public const string SamplesFolder = "Assets/UI/Why/Samples";
        public const string DemoScenePath = "Assets/UI/Why/WhyDemo.unity";
        public const string PanelSettingsPath = "Assets/UI/Why/Resources/Why/WhyDemoPanelSettings.asset";
        public const string ThemePath = "Assets/UI/Why/WhyDemoTheme.tss";
        private const string DemoPlayerPath = "Builds/WhyDemo/WhyDemo.exe";

        [MenuItem("Ringside Booker/Why? panel samples")]
        public static void ShowWindow()
        {
            GetWindow<WhySamplesWindow>("Why? samples").minSize = new Vector2(900, 600);
        }

        private void CreateGUI()
        {
            rootVisualElement.style.backgroundColor = new Color(0.08f, 0.09f, 0.11f);
            WhyDemo.BuildSampleList(rootVisualElement,
                SampleAssets().Select(asset => (asset.name, asset.text)),
                action => rootVisualElement.schedule.Execute(action).StartingIn(600));
        }

        private static TextAsset[] SampleAssets() =>
            AssetDatabase.FindAssets("t:TextAsset", new[] { SamplesFolder })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Where(path => path.EndsWith(".json"))
                .OrderBy(path => path)
                .Select(AssetDatabase.LoadAssetAtPath<TextAsset>)
                .ToArray();

        /// <summary>
        /// Creates (or refreshes) the demo scene: a UIDocument with its own panel settings and the
        /// default runtime theme, and a <see cref="WhyDemo"/> holding every sample.
        /// </summary>
        [MenuItem("Ringside Booker/Why? demo scene (rebuild)")]
        public static void BuildDemoScene()
        {
            var settings = AssetDatabase.LoadAssetAtPath<PanelSettings>(PanelSettingsPath);
            if (settings == null)
            {
                settings = CreateInstance<PanelSettings>();
                settings.themeStyleSheet = AssetDatabase.LoadAssetAtPath<ThemeStyleSheet>(ThemePath);
                settings.scaleMode = PanelScaleMode.ConstantPixelSize;
                AssetDatabase.CreateAsset(settings, PanelSettingsPath);
            }

            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            var host = new GameObject("Why? demo");
            var document = host.AddComponent<UIDocument>();
            var documentFields = new SerializedObject(document);
            documentFields.FindProperty("m_PanelSettings").objectReferenceValue = settings;
            documentFields.ApplyModifiedPropertiesWithoutUndo();
            var demo = host.AddComponent<WhyDemo>();
            var serialized = new SerializedObject(demo);
            serialized.FindProperty("document").objectReferenceValue = document;
            serialized.FindProperty("panelSettings").objectReferenceValue = settings;
            SerializedProperty list = serialized.FindProperty("samples");
            TextAsset[] samples = SampleAssets();
            list.arraySize = samples.Length;
            for (int index = 0; index < samples.Length; index++)
            {
                list.GetArrayElementAtIndex(index).objectReferenceValue = samples[index];
            }
            serialized.ApplyModifiedPropertiesWithoutUndo();
            EditorSceneManager.SaveScene(scene, DemoScenePath);
            AssetDatabase.SaveAssets();
            Debug.Log($"[Why] Demo scene saved to {DemoScenePath} with {samples.Length} samples");
        }

        /// <summary>
        /// Batch mode: rebuilds the demo scene and builds it alone as a Windows player at
        /// game/Builds/WhyDemo/WhyDemo.exe (not the game's build). Run that player with
        /// <c>-batchmode -whyScreenshots &lt;folder&gt;</c> to screenshot every sample's panel.
        /// </summary>
        public static void BuildDemoPlayer()
        {
            BuildDemoScene();
            string projectRoot = Directory.GetParent(Application.dataPath).FullName;
            string output = Path.Combine(projectRoot, DemoPlayerPath);
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            BuildReport report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { DemoScenePath },
                locationPathName = output,
                target = BuildTarget.StandaloneWindows64,
                targetGroup = BuildTargetGroup.Standalone,
                options = BuildOptions.None,
            });
            Debug.Log($"[Why] Demo player {report.summary.result}: {output}");
            if (Application.isBatchMode) EditorApplication.Exit(report.summary.result == BuildResult.Succeeded ? 0 : 1);
        }
    }
}
