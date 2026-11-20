using System;
using System.Collections;
using System.IO;
using RingsideBooker.Release;
using RingsideBooker.Release.Access;
using RingsideBooker.UI;
using RingsideBooker.UI.Access;
using RingsideBooker.UI.Title;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// The tester access tour (POL9-12), for a packaged alpha or beta build:
    /// <c>RingsideBooker.exe -screen-fullscreen 0 -rbAccessTour &lt;folder&gt; [-rbAccessCode RB-XXXX-XXXX] [-rbAccessRemove]</c>.
    /// <list type="bullet">
    /// <item>With a code: the gate shows; a made-up code gets "That code isn't valid"; the real code is
    /// typed into the gate and Start playing pressed (a real call to the service); Settings › About
    /// shows "Tester access: active"; then the demo game starts.</item>
    /// <item>Without one: the licence from the last run is remembered (no gate), and About says so.</item>
    /// <item><c>-rbAccessRemove</c>: presses Remove this code (and confirms), and the gate comes back.</item>
    /// </list>
    /// PNGs go to the folder. Exit 0 = every check passed.
    /// </summary>
    public sealed class AccessTour : MonoBehaviour
    {
        public const string CodeArgument = "-rbAccessCode";
        public const string RemoveArgument = "-rbAccessRemove";

        private string folder;
        private string code;
        private bool remove;
        private int index;
        private int failures;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartIfAsked()
        {
            string[] args = Environment.GetCommandLineArgs();
            string folder = null, code = null;
            bool remove = false;
            for (int i = 0; i < args.Length; i++)
            {
                if (string.Equals(args[i], AccessService.TourArgument, StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) folder = args[i + 1];
                if (string.Equals(args[i], CodeArgument, StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) code = args[i + 1];
                if (string.Equals(args[i], RemoveArgument, StringComparison.OrdinalIgnoreCase)) remove = true;
            }
            if (folder == null || Application.isBatchMode) return;
            var host = new GameObject("AccessTour");
            DontDestroyOnLoad(host);
            AccessTour tour = host.AddComponent<AccessTour>();
            tour.folder = folder;
            tour.code = code;
            tour.remove = remove;
        }

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), 120f);
            Directory.CreateDirectory(folder);
            Debug.Log($"[AccessTour] {ReleaseInfo.Version} channel {ReleaseInfo.Channel}; gate applies: {AccessService.AppliesToBuild}, required: {AccessService.GateRequired}");
            Check(AccessService.GateRequired, "the gate applies to this build (packaged alpha/beta with a key)");
            while (SceneManager.GetActiveScene().name != SceneFlow.TitleScene) yield return null;
            yield return Wait(1.5f);
            VisualElement title = FindAnyObjectByType<TitleController>().GetComponent<UIDocument>().rootVisualElement;

            if (code != null) yield return Activate(title);
            else if (remove) yield return Remove(title);
            else yield return Remembered(title);

            Debug.Log(failures == 0 ? "[AccessTour] PASSED" : $"[AccessTour] FAILED ({failures})");
            Application.Quit(failures == 0 ? 0 : 1);
        }

        private IEnumerator Activate(VisualElement title)
        {
            AccessGate gate = AccessGate.Current;
            Check(gate != null && gate.IsShowing, "the gate shows before the menu");
            Check(title.Q<VisualElement>("title-screen")?.resolvedStyle.display == DisplayStyle.None, "the title menu is hidden behind it");
            if (gate == null) yield break;
            yield return Capture("gate");

            gate.Field.Input.value = "RB-2222-2222";
            Click(gate.SubmitButton);
            yield return WaitWhileBusy();
            Label error = gate.Element.Q<Label>(className: "dsf-error");
            Check(error != null && error.text.StartsWith("That code isn't valid", StringComparison.Ordinal), "a made-up code is refused in plain words");
            Check(gate.SubmitButton.enabledSelf, "Start playing works again after the error");
            yield return Wait(0.3f);
            yield return Capture("gate-invalid-code");

            gate.Field.Input.value = code.ToLowerInvariant();
            Click(gate.SubmitButton);
            yield return WaitWhileBusy();
            yield return Wait(0.5f);
            Check(AccessService.IsActive, "the real code is accepted");
            Check(!gate.IsShowing, "the gate goes away");
            Check(title.Q<VisualElement>("title-screen")?.resolvedStyle.display == DisplayStyle.Flex, "the title menu is back");
            yield return Capture("title-after-code");

            yield return About(title, "settings-about-active");

            // Play: the demo game.
            Click(title.Q<Button>("menu-new-game"));
            yield return Wait(0.5f);
            Click(title.Q<Button>("start-demo"));
            float until = Time.realtimeSinceStartup + 30f;
            while (SceneManager.GetActiveScene().name != SceneFlow.GameScene && Time.realtimeSinceStartup < until) yield return null;
            Check(SceneManager.GetActiveScene().name == SceneFlow.GameScene, "the game starts");
            yield return Wait(3f);
            yield return Capture("playing");
        }

        private IEnumerator Remembered(VisualElement title)
        {
            Check(AccessGate.Current == null || !AccessGate.Current.IsShowing, "no gate: the code is remembered");
            Check(AccessService.IsActive, "the stored licence is active");
            yield return Capture("title-remembered");
            yield return About(title, "settings-about-remembered");
        }

        private IEnumerator Remove(VisualElement title)
        {
            Check(AccessService.IsActive, "a licence is stored before Remove");
            yield return About(title, "settings-about-before-remove");
            Click(title.Q<Button>("access-remove"));
            yield return Wait(0.6f);
            yield return Capture("remove-confirm");
            Button confirm = null;
            title.Query<Button>().ForEach(button =>
            {
                Label label = button.Q<Label>(className: "ds-btn__label");
                if (label != null && string.Equals(label.text, "Remove", StringComparison.OrdinalIgnoreCase)) confirm = button;
            });
            Check(confirm != null, "the confirm button is there");
            Click(confirm);
            yield return Wait(0.8f);
            Check(!AccessService.IsActive, "the licence is gone");
            Check(AccessGate.Current != null && AccessGate.Current.IsShowing, "the gate comes back");
            yield return Capture("gate-after-remove");
        }

        private IEnumerator About(VisualElement title, string shot)
        {
            Click(title.Q<Button>("menu-settings"));
            yield return Wait(0.8f);
            Label status = title.Q<Label>("access-status");
            Check(status != null && status.text.StartsWith("Tester access: active (RB-", StringComparison.Ordinal) && status.text.EndsWith("-••••)", StringComparison.Ordinal),
                $"About says the access is active with the code partly hidden ({status?.text})");
            title.Q<ScrollView>("title-settings-scroll")?.ScrollTo(title.Q<VisualElement>("settings-access"));
            yield return Wait(0.4f);
            yield return Capture(shot);
        }

        private static IEnumerator WaitWhileBusy()
        {
            yield return null;
            float until = Time.realtimeSinceStartup + 30f;
            while (AccessService.Busy && Time.realtimeSinceStartup < until) yield return null;
            yield return null;
        }

        private void Check(bool ok, string what)
        {
            if (ok)
            {
                Debug.Log($"[AccessTour] ok: {what}");
                return;
            }
            failures++;
            Debug.LogError($"[AccessTour] FAILED: {what}");
        }

        private void GiveUp()
        {
            Debug.LogError("[AccessTour] timed out");
            Application.Quit(1);
        }

        private static void Click(Button button)
        {
            if (button == null)
            {
                Debug.LogWarning("[AccessTour] button not found");
                return;
            }
            using (NavigationSubmitEvent submit = NavigationSubmitEvent.GetPooled())
            {
                submit.target = button;
                button.SendEvent(submit);
            }
        }

        private static IEnumerator Wait(float seconds)
        {
            float until = Time.realtimeSinceStartup + seconds;
            while (Time.realtimeSinceStartup < until) yield return null;
        }

        private IEnumerator Capture(string name)
        {
            yield return new WaitForEndOfFrame();
            index++;
            string path = Path.Combine(folder, $"{index:00}-{name}-{Screen.width}x{Screen.height}.png");
            ScreenCapture.CaptureScreenshot(path);
            yield return null;
            yield return null;
            Debug.Log($"[AccessTour] {path}");
        }
    }
}
