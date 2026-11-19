using System;
using System.IO;
using System.Linq;
using RingsideBooker;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

/// <summary>
/// Batch-mode entry points, called from game/tools/*.sh with -executeMethod.
/// </summary>
public static class BuildScripts
{
    public const string BootScenePath = "Assets/Scenes/Boot.unity";
    private const string WindowsOutput = "Builds/Windows/RingsideBooker.exe";

    /// <summary>Builds the Windows 64-bit player to game/Builds/Windows/RingsideBooker.exe.</summary>
    public static void BuildWindows()
    {
        EnsureBootScene();

        string projectRoot = Directory.GetParent(Application.dataPath).FullName;
        string outputPath = Path.Combine(projectRoot, WindowsOutput);
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath));

        var options = new BuildPlayerOptions
        {
            scenes = EditorBuildSettings.scenes.Where(scene => scene.enabled).Select(scene => scene.path).ToArray(),
            locationPathName = outputPath,
            target = BuildTarget.StandaloneWindows64,
            targetGroup = BuildTargetGroup.Standalone,
            options = BuildOptions.None,
        };

        BuildReport report = BuildPipeline.BuildPlayer(options);
        BuildSummary summary = report.summary;
        Debug.Log($"[BuildScripts] Windows build {summary.result}: {summary.outputPath} " +
                  $"({summary.totalSize} bytes, {summary.totalErrors} errors, {summary.totalTime})");

        if (Application.isBatchMode)
        {
            EditorApplication.Exit(summary.result == BuildResult.Succeeded ? 0 : 1);
        }
    }

    /// <summary>
    /// Creates Assets/Scenes/Boot.unity (a single GameObject with the Boot behaviour) if it
    /// is missing, and makes it the first enabled scene in the build settings.
    /// </summary>
    [MenuItem("Ringside Booker/Ensure Boot Scene")]
    public static void EnsureBootScene()
    {
        if (!File.Exists(BootScenePath))
        {
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            var bootObject = new GameObject("Boot");
            bootObject.AddComponent<Boot>();
            Directory.CreateDirectory(Path.GetDirectoryName(BootScenePath));
            if (!EditorSceneManager.SaveScene(scene, BootScenePath))
            {
                throw new InvalidOperationException($"Could not save {BootScenePath}");
            }
            Debug.Log($"[BuildScripts] Created {BootScenePath}");
        }

        EditorBuildSettingsScene[] current = EditorBuildSettings.scenes;
        if (current.Length == 0 || current[0].path != BootScenePath || !current[0].enabled)
        {
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(BootScenePath, true) }
                .Concat(current.Where(scene => scene.path != BootScenePath))
                .ToArray();
            Debug.Log($"[BuildScripts] {BootScenePath} set as the first build scene");
        }

        AssetDatabase.SaveAssets();
    }
}
