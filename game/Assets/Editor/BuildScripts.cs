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

    /// <summary>The version a build gets without <c>-rbVersion</c>.</summary>
    public const string DevVersion = "0.1.0-dev";
    public const string VersionArgument = "-rbVersion";
    private const string LicensesFolder = "Assets/StreamingAssets/licenses";

    /// <summary>
    /// Builds the Windows 64-bit player to game/Builds/Windows/RingsideBooker.exe. The version
    /// (<c>Application.version</c>, shown on the title screen) comes from <c>-rbVersion &lt;v&gt;</c>
    /// (game/tools/package-windows.sh passes <c>0.1.0-u1+&lt;sha&gt;</c>) and is not saved into the
    /// project. The third-party notices are staged into StreamingAssets/licenses (the title's
    /// Settings › Credits &amp; licences reads them), and no source map ships in the player.
    /// </summary>
    public static void BuildWindows()
    {
        EnsureBootScene();

        string projectRoot = Directory.GetParent(Application.dataPath).FullName;
        string outputPath = Path.Combine(projectRoot, WindowsOutput);
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath));
        string version = CommandLineValue(VersionArgument) ?? DevVersion;

        if (!File.Exists(Path.Combine(Application.streamingAssetsPath, "engine", "engine.js")))
        {
            Debug.LogError("[BuildScripts] StreamingAssets/engine/engine.js is missing: build the engine bundle first " +
                           "(npm run build:engine-bundle, or game/tools/package-windows.sh)");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            return;
        }
        StageLicenses(projectRoot);

        var options = new BuildPlayerOptions
        {
            scenes = EditorBuildSettings.scenes.Where(scene => scene.enabled).Select(scene => scene.path).ToArray(),
            locationPathName = outputPath,
            target = BuildTarget.StandaloneWindows64,
            targetGroup = BuildTargetGroup.Standalone,
            options = BuildOptions.None,
        };

        string savedVersion = PlayerSettings.bundleVersion;
        BuildReport report;
        try
        {
            PlayerSettings.bundleVersion = version;
            report = BuildPipeline.BuildPlayer(options);
        }
        finally
        {
            PlayerSettings.bundleVersion = savedVersion;
            AssetDatabase.SaveAssets();
        }
        BuildSummary summary = report.summary;
        if (summary.result == BuildResult.Succeeded) RemoveSourceMaps(outputPath);
        Debug.Log($"[BuildScripts] Windows build {summary.result}: {summary.outputPath} version {version} " +
                  $"({summary.totalSize} bytes, {summary.totalErrors} errors, {summary.totalTime})");

        if (Application.isBatchMode)
        {
            EditorApplication.Exit(summary.result == BuildResult.Succeeded ? 0 : 1);
        }
    }

    /// <summary>The value after <paramref name="name"/> on the command line, or null.</summary>
    private static string CommandLineValue(string name)
    {
        string[] args = Environment.GetCommandLineArgs();
        for (int index = 0; index < args.Length - 1; index++)
        {
            if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase)) return args[index + 1];
        }
        return null;
    }

    /// <summary>
    /// Copies the third-party notices (game/docs/licenses, the ClearScript and SQLite plugin notes,
    /// the fonts' OFL texts) into StreamingAssets/licenses, which is generated and gitignored.
    /// </summary>
    [MenuItem("Ringside Booker/Stage Licence Notices")]
    public static void StageLicenses() => StageLicenses(Directory.GetParent(Application.dataPath).FullName);

    private static void StageLicenses(string projectRoot)
    {
        string target = Path.Combine(projectRoot, LicensesFolder);
        if (Directory.Exists(target)) Directory.Delete(target, true);
        Directory.CreateDirectory(target);
        string[] sources =
        {
            "docs/licenses/THIRD-PARTY-NOTICES.txt",
            "Assets/Plugins/ClearScript/LICENSE-ClearScript.txt",
            "Assets/Plugins/Sqlite/README-sqlite.txt",
            "Assets/UI/Fonts/OFL-BarlowCondensed.txt",
            "Assets/UI/Fonts/OFL-Inter.txt",
        };
        foreach (string source in sources)
        {
            string path = Path.Combine(projectRoot, source);
            if (!File.Exists(path)) throw new FileNotFoundException($"Licence notice missing: {source}", path);
            File.Copy(path, Path.Combine(target, Path.GetFileName(path)), true);
        }
        AssetDatabase.Refresh();
        Debug.Log($"[BuildScripts] Staged {sources.Length} licence notices in {LicensesFolder}");
    }

    /// <summary>Deletes every *.map the player's StreamingAssets got (the engine bundle's source map).</summary>
    private static void RemoveSourceMaps(string exePath)
    {
        string dataFolder = Path.Combine(Path.GetDirectoryName(exePath), Path.GetFileNameWithoutExtension(exePath) + "_Data", "StreamingAssets");
        if (!Directory.Exists(dataFolder)) return;
        foreach (string map in Directory.GetFiles(dataFolder, "*.map", SearchOption.AllDirectories))
        {
            File.Delete(map);
            Debug.Log($"[BuildScripts] Removed {map} from the player");
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
