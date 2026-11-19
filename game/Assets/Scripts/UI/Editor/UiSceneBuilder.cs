using System;
using System.IO;
using System.Linq;
using RingsideBooker.UI.Settings;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Title;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.EditorTools
{
    /// <summary>
    /// Creates (or recreates) the UI assets the scenes need: Assets/UI/PanelSettings.asset (the
    /// RingsideTheme, 1280×720 reference, scale with screen) and the Title and Game scenes (a
    /// UIDocument with the UXML, UiScale and the scene's controller), and puts them in the build
    /// after Boot. Run from the menu or in batch mode:
    /// <c>-executeMethod RingsideBooker.UI.EditorTools.UiSceneBuilder.BuildAll</c>.
    /// </summary>
    public static class UiSceneBuilder
    {
        public const string PanelSettingsPath = "Assets/UI/PanelSettings.asset";
        public const string ThemePath = "Assets/UI/Theme/RingsideTheme.tss";
        public const string TitleUxmlPath = "Assets/UI/Uxml/Title.uxml";
        public const string ShellUxmlPath = "Assets/UI/Uxml/Shell.uxml";
        public const string BootScenePath = "Assets/Scenes/Boot.unity";
        public const string TitleScenePath = "Assets/Scenes/Title.unity";
        public const string GameScenePath = "Assets/Scenes/Game.unity";

        private static readonly Color Background = new Color32(0x09, 0x0d, 0x16, 0xff);

        [MenuItem("Ringside Booker/Build UI Scenes")]
        public static void BuildAll()
        {
            try
            {
                EnsurePanelSettings();
                AssetDatabase.SaveAssets();
                BuildScene(TitleScenePath, TitleUxmlPath, typeof(TitleController));
                BuildScene(GameScenePath, ShellUxmlPath, typeof(ShellController));
                EnsureBuildScenes();
                AssetDatabase.SaveAssets();
                Debug.Log("[UiSceneBuilder] Title and Game scenes built");
                if (Application.isBatchMode) EditorApplication.Exit(0);
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
                if (Application.isBatchMode) EditorApplication.Exit(1);
                else throw;
            }
        }

        private static void EnsurePanelSettings()
        {
            var theme = AssetDatabase.LoadAssetAtPath<ThemeStyleSheet>(ThemePath);
            if (theme == null) throw new InvalidOperationException($"Missing theme {ThemePath}");

            var settings = AssetDatabase.LoadAssetAtPath<PanelSettings>(PanelSettingsPath);
            bool created = settings == null;
            if (created) settings = ScriptableObject.CreateInstance<PanelSettings>();

            settings.themeStyleSheet = theme;
            settings.scaleMode = PanelScaleMode.ScaleWithScreenSize;
            settings.screenMatchMode = PanelScreenMatchMode.Shrink;
            settings.referenceResolution = UiScale.ReferenceResolution;
            settings.clearColor = true;
            settings.colorClearValue = Background;

            if (created) AssetDatabase.CreateAsset(settings, PanelSettingsPath);
            else EditorUtility.SetDirty(settings);
        }

        private static void BuildScene(string scenePath, string uxmlPath, Type controller)
        {
            // A new scene unloads unused assets, so load the references after creating it.
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var tree = AssetDatabase.LoadAssetAtPath<VisualTreeAsset>(uxmlPath);
            if (tree == null) throw new InvalidOperationException($"Missing UXML {uxmlPath}");
            var panelSettings = AssetDatabase.LoadAssetAtPath<PanelSettings>(PanelSettingsPath);

            var cameraObject = new GameObject("Camera");
            var camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Background;
            camera.cullingMask = 0;
            camera.orthographic = true;

            var ui = new GameObject("UI");
            var document = ui.AddComponent<UIDocument>();
            document.panelSettings = panelSettings;
            document.visualTreeAsset = tree;
            ui.AddComponent<UiScale>();
            ui.AddComponent(controller);

            Directory.CreateDirectory(Path.GetDirectoryName(scenePath));
            if (!EditorSceneManager.SaveScene(scene, scenePath))
            {
                throw new InvalidOperationException($"Could not save {scenePath}");
            }
            VerifyScene(scenePath, uxmlPath);
        }

        /// <summary>Reopens the saved scene and checks the UIDocument kept its references.</summary>
        private static void VerifyScene(string scenePath, string uxmlPath)
        {
            Scene scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
            var tree = AssetDatabase.LoadAssetAtPath<VisualTreeAsset>(uxmlPath);
            var panelSettings = AssetDatabase.LoadAssetAtPath<PanelSettings>(PanelSettingsPath);
            GameObject ui = scene.GetRootGameObjects().First(root => root.GetComponent<UIDocument>() != null);
            var document = ui.GetComponent<UIDocument>();
            if (panelSettings == null || tree == null || document.panelSettings != panelSettings || document.visualTreeAsset != tree)
            {
                throw new InvalidOperationException($"UI references did not stick in {scenePath}");
            }
        }

        /// <summary>Boot first, then Title and Game; other scenes keep their places after them.</summary>
        private static void EnsureBuildScenes()
        {
            string[] ours = { BootScenePath, TitleScenePath, GameScenePath };
            EditorBuildSettings.scenes = ours
                .Select(path => new EditorBuildSettingsScene(path, true))
                .Concat(EditorBuildSettings.scenes.Where(scene => !ours.Contains(scene.path)))
                .ToArray();
        }
    }
}
