using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using RingsideBooker.Engine;
using RingsideBooker.Import;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// Choose a folder tour (UNITY-34): run the player with
    /// <c>-rbFolderShots &lt;shots folder&gt; -rbFolderShotsMods &lt;folder&gt;</c>, where the mods folder
    /// comes from <c>game/tools/make-fictional-mod-folders.py</c> (fictional worlds only). The Steam
    /// scan is switched off so only the fictional mods show. It opens New game › Import a workshop
    /// world, adds one mod folder, a folder of two mods and a folder with no database (the plain
    /// message), removes one folder, imports the single mod and uses it, with a PNG at each step.
    /// Afterwards it forgets the folders it added and removes the world it stored. Exit 0 = PASSED.
    /// The Windows folder picker itself is modal, so the tour adds folders through
    /// <see cref="NewGameWizard.AddFolder"/>, the method the button calls with the picked folder.
    /// </summary>
    public sealed class FolderImportShots : MonoBehaviour
    {
        public const string Argument = "-rbFolderShots";
        public const string ModsArgument = "-rbFolderShotsMods";

        private string shots;
        private string modsRoot;
        private int shotIndex;
        private readonly List<string> problems = new List<string>();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartIfAsked()
        {
            string shots = Value(Argument);
            string mods = Value(ModsArgument);
            if (shots == null || Application.isBatchMode) return;
            var host = new GameObject("FolderImportShots");
            DontDestroyOnLoad(host);
            FolderImportShots tour = host.AddComponent<FolderImportShots>();
            tour.shots = shots;
            tour.modsRoot = mods;
        }

        private static string Value(string name)
        {
            string[] args = Environment.GetCommandLineArgs();
            int at = Array.FindIndex(args, arg => string.Equals(arg, name, StringComparison.OrdinalIgnoreCase));
            return at >= 0 && at + 1 < args.Length ? args[at + 1] : null;
        }

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), 300f);
            if (modsRoot == null || !Directory.Exists(modsRoot))
            {
                Debug.LogError($"[FolderShots] pass {ModsArgument} <folder> made by make-fictional-mod-folders.py");
                Application.Quit(1);
                yield break;
            }
            WorkshopWorlds.SkipSteamScan = true;
            var before = new HashSet<string>(WorkshopWorlds.Folders.Folders, StringComparer.OrdinalIgnoreCase);
            var added = new List<string>();
            string single = Path.Combine(modsRoot, "Testverse Classic");
            string several = Path.Combine(modsRoot, "Several worlds");
            string notAMod = Path.Combine(modsRoot, "Not a mod");

            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != SceneFlow.TitleScene) yield return null;
            while (NewGameWizard.Active == null) yield return null;
            yield return new WaitForSecondsRealtime(1f);
            NewGameWizard wizard = NewGameWizard.Active;
            Task<IReadOnlyList<WorkshopMod>> scan = wizard.OpenImportAndScan();
            yield return Await(scan);
            yield return new WaitForSecondsRealtime(0.5f);
            Expect(Find<Button>("import-choose-folder") != null, "the Choose a folder… button is on the import screen");
            yield return Capture("import-choose-folder");

            foreach (string folder in new[] { single, several })
            {
                Task<FolderCheck> add = wizard.AddFolder(folder);
                yield return Await(add);
                Expect(add.Result != null && add.Result.Ok, $"folder {added.Count + 1} qualifies");
                added.Add(folder);
                yield return new WaitForSecondsRealtime(0.4f);
                yield return Capture(added.Count == 1 ? "your-folders-one-mod" : "your-folders-several-mods");
            }
            Expect(wizard.YourFolders.Count == before.Count + 2, "both folders are listed under Your folders");
            Expect(wizard.YourFolders.Any(check => check.Mods.Count == 2), "the folder of mods lists each of its two mods");

            Task<FolderCheck> refused = wizard.AddFolder(notAMod);
            yield return Await(refused);
            yield return new WaitForSecondsRealtime(0.4f);
            Expect(refused.Result != null && !refused.Result.Ok && wizard.FolderProblem == ModFolders.NoDatabaseProblem,
                "a folder with no database shows what is missing");
            Expect(Find<Label>("import-folder-problem") != null, "the message is on screen");
            Expect(!WorkshopWorlds.Folders.Folders.Any(folder => ImportFolderSettings.SameFolder(folder, notAMod)), "the refused folder is not remembered");
            yield return Capture("folder-without-database");

            int index = wizard.YourFolders.ToList().FindIndex(check => ImportFolderSettings.SameFolder(check.Folder, several));
            Click($"folder-remove-{index}");
            yield return new WaitForSecondsRealtime(0.4f);
            Expect(!WorkshopWorlds.Folders.Folders.Any(folder => ImportFolderSettings.SameFolder(folder, several)), "Remove forgets the folder");
            Expect(Directory.Exists(several), "Remove leaves the folder itself alone");
            yield return Capture("after-remove");

            WorkshopMod mod = wizard.YourFolders.SelectMany(check => check.Mods)
                .First(candidate => string.Equals(candidate.Folder, ModFolders.Normalize(single), StringComparison.OrdinalIgnoreCase));
            wizard.PickMod(mod.ItemId);
            Task<WorldModImportResult> run = wizard.RunImport();
            yield return Await(run);
            yield return new WaitForSecondsRealtime(0.5f);
            Expect(run.Result != null && run.Result.Ok, $"the chosen folder imports ({(run.Result == null ? "no result" : run.Result.ReasonCodes)})");
            Expect(WorkshopWorlds.StoredFor(mod)?.ModFolder == mod.Folder, "the stored world points at the chosen folder (pictures read in place)");
            yield return Capture(run.Result != null && run.Result.Ok ? "import-report" : "import-failed");
            if (run.Result != null && run.Result.Ok)
            {
                Click("import-use");
                float until = Time.realtimeSinceStartup + 20f;
                while (wizard.SelectedWorldId != mod.PackId && Time.realtimeSinceStartup < until) yield return null;
                yield return new WaitForSecondsRealtime(0.5f);
                // No picture here: the world list also shows the player's own stored worlds (real mod names).
                Expect(wizard.SelectedWorldId == mod.PackId, "back on New game with the imported world selected");
            }

            // Clean up: the tour's folders and world never stay in the player's settings.
            Task<EngineClient> clientTask = EngineRuntime.GetClientAsync();
            yield return Await(clientTask);
            if (WorkshopWorlds.StoredFor(mod) != null) yield return Await(WorkshopWorlds.RemoveStoredAsync(clientTask.Result, mod.PackId));
            foreach (string folder in WorkshopWorlds.Folders.Folders.Where(folder => !before.Contains(folder)).ToList()) WorkshopWorlds.RemoveFolder(folder);
            WorkshopWorlds.SkipSteamScan = false;

            Debug.Log($"[FolderShots] {(problems.Count == 0 ? "PASSED" : "FAILED: " + string.Join("; ", problems))}");
            Application.Quit(problems.Count == 0 ? 0 : 1);
        }

        private void Expect(bool condition, string what)
        {
            Debug.Log($"[FolderShots] {(condition ? "ok" : "NOT OK")}: {what}");
            if (!condition) problems.Add(what);
        }

        private void GiveUp()
        {
            Debug.LogError("[FolderShots] timed out");
            Application.Quit(1);
        }

        private static T Find<T>(string name) where T : VisualElement
        {
            var document = FindAnyObjectByType<UIDocument>();
            return document?.rootVisualElement.Q<T>(name);
        }

        private static void Click(string name)
        {
            Button button = Find<Button>(name);
            if (button == null)
            {
                Debug.LogWarning($"[FolderShots] no button {name}");
                return;
            }
            using (NavigationSubmitEvent submit = NavigationSubmitEvent.GetPooled())
            {
                submit.target = button;
                button.SendEvent(submit);
            }
        }

        private static IEnumerator Await(Task task)
        {
            while (!task.IsCompleted) yield return null;
            if (task.IsFaulted) Debug.LogException(task.Exception);
        }

        private IEnumerator Capture(string name)
        {
            Directory.CreateDirectory(shots);
            yield return new WaitForEndOfFrame();
            shotIndex++;
            string path = Path.Combine(shots, $"{shotIndex:00}-{name}-{Screen.width}x{Screen.height}.png");
            ScreenCapture.CaptureScreenshot(path);
            yield return null;
            yield return null;
            Debug.Log($"[FolderShots] {Path.GetFileName(path)}");
        }
    }
}
