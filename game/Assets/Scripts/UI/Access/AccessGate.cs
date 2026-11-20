using System;
using RingsideBooker.Release;
using RingsideBooker.Release.Access;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using RingsideBooker.UI.WhatsNew;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Access
{
    /// <summary>
    /// The tester-code screen in front of the title menu (POL9-12). It covers the title (the menu
    /// and any sheet are hidden, so nothing behind it takes focus) until a code is accepted, then
    /// hands the title back. Only for <see cref="AccessService.GateRequired"/> builds.
    /// <para>Elements: <c>access-gate</c>, <c>access-code</c> (the text input), <c>access-submit</c>,
    /// <c>access-retry</c> (check in again, when a stored licence ran out), <c>access-quit</c>,
    /// <c>access-notice</c>.</para>
    /// </summary>
    public sealed class AccessGate
    {
        public const string GateName = "access-gate";
        private const string Resource = "Access/Access";

        private readonly VisualElement root;
        private readonly Action passed;
        private VisualElement gate;
        private DsTextField field;
        private Button submit;
        private Button retry;
        private Label notice;

        /// <summary>The gate on screen now, if any (tours and tests).</summary>
        public static AccessGate Current { get; private set; }

        public VisualElement Element => gate;
        public DsTextField Field => field;
        public Button SubmitButton => submit;
        public bool IsShowing => gate != null && gate.parent != null;

        private AccessGate(VisualElement root, Action passed)
        {
            this.root = root;
            this.passed = passed;
        }

        public static void Apply(VisualElement element)
        {
            if (element == null) return;
            StyleSheet sheet = Resources.Load<StyleSheet>(Resource);
            if (sheet != null && !element.styleSheets.Contains(sheet)) element.styleSheets.Add(sheet);
        }

        /// <summary>
        /// One line in TitleController: shows the gate when this build needs a code and none is active,
        /// and keeps watching, so a code the service turns off while the title is open brings it back.
        /// An active licence checks back in the background when due. <paramref name="passed"/> runs
        /// when a code is accepted (focus the menu).
        /// </summary>
        public static void AttachToTitle(VisualElement root, Action passed)
        {
            if (!AccessService.GateRequired) return;
            var title = new AccessGate(root, passed);
            Action onChanged = () => title.ShowIfNeeded();
            AccessService.Changed += onChanged;
            root.RegisterCallback<DetachFromPanelEvent>(_ => AccessService.Changed -= onChanged);
            title.ShowIfNeeded();
            if (!title.IsShowing) AccessService.RefreshIfDue();
        }

        private void ShowIfNeeded()
        {
            AccessVerdict verdict = AccessService.Check(out LicencePayload payload);
            Debug.Log($"[Access] start: {verdict}{(payload != null ? $" ({payload.MaskedCode})" : string.Empty)}");
            if (verdict == AccessVerdict.Active) return;
            if (verdict == AccessVerdict.Invalid || verdict == AccessVerdict.WrongChannel) AccessService.Store.ClearToken();
            Show(verdict);
            // A real licence that ran out (30 days offline): try one check in at once.
            if (verdict == AccessVerdict.Expired) Retry();
        }

        private void Show(AccessVerdict verdict)
        {
            if (IsShowing) return;
            Apply(root);
            Build(verdict);
            SetTitleShown(false);
            root.Add(gate);
            Current = this;
            gate.schedule.Execute(FocusField).ExecuteLater(100);
            // The title's own start-up (What's new) may move focus; take it back.
            gate.schedule.Execute(FocusField).ExecuteLater(700);
        }

        private void FocusField()
        {
            if (IsShowing) field?.Input.Focus();
        }

        private void SetTitleShown(bool shown)
        {
            foreach (VisualElement child in root.Children())
            {
                if (child != gate) child.style.display = shown ? DisplayStyle.Flex : DisplayStyle.None;
            }
        }

        private void Build(AccessVerdict verdict)
        {
            gate = Ui.El("acc-gate").Named(GateName);
            gate.pickingMode = PickingMode.Position;
            VisualElement card = Ui.El("acc-card");
            gate.Add(card);

            VisualElement brand = Ds.Row("acc-brand");
            VisualElement icon = BrandIcon.Create(BrandIcon.Large, 56, "acc-brand__icon");
            if (icon != null) brand.Add(icon);
            brand.Add(Ds.Text(TextFormat.Upper("Ringside Booker"), "acc-brand__name"));
            Label badge = ChannelBadge.Create("acc-brand__badge");
            if (badge != null) brand.Add(badge);
            card.Add(brand);

            card.Add(Ds.Text(TextFormat.Upper(AccessMessages.GateTitle), "acc-title"));
            card.Add(Ds.Text(AccessMessages.GateIntro, "acc-intro"));

            notice = Ds.Text(AccessMessages.GateCheckIn, "acc-notice", "ds-state--warn").Named("access-notice");
            notice.SetShown(verdict == AccessVerdict.Expired);
            card.Add(notice);

            field = new DsTextField("Tester code", string.Empty, _ => field?.SetError(null), null, "access-code", 20, AccessCode.Example);
            field.AddToClassList("acc-field");
            field.Input.RegisterCallback<KeyDownEvent>(evt =>
            {
                if (evt.keyCode != KeyCode.Return && evt.keyCode != KeyCode.KeypadEnter) return;
                Submit();
                evt.StopPropagation();
            }, TrickleDown.TrickleDown);
            card.Add(field);

            VisualElement actions = Ds.Row("acc-actions");
            submit = Ds.Button("Start playing", Submit, DsButtonKind.Primary, "chevron-right");
            submit.name = "access-submit";
            actions.Add(submit);
            retry = Ds.Button("Try again", Retry, DsButtonKind.Secondary, "reset");
            retry.name = "access-retry";
            retry.SetShown(verdict == AccessVerdict.Expired);
            actions.Add(retry);
            VisualElement spacer = Ui.El("acc-actions__spacer");
            actions.Add(spacer);
            Button quit = Ds.Button("Quit", SceneFlow.Quit, DsButtonKind.Ghost);
            quit.name = "access-quit";
            actions.Add(quit);
            card.Add(actions);

            card.Add(Ds.Text(AccessMessages.GatePrivacy, "acc-privacy"));
        }

        /// <summary>Sends the typed code (the button and Enter).</summary>
        public void Submit()
        {
            if (AccessService.Busy) return;
            string typed = field.Value;
            if (string.IsNullOrWhiteSpace(typed))
            {
                field.SetError("Type your tester code first.");
                FocusField();
                return;
            }
            SetBusy(true, "Checking…");
            AccessService.Activate(typed, error => Finish(error, submitted: true));
        }

        /// <summary>Checks a stored licence in again (Try again).</summary>
        public void Retry()
        {
            if (AccessService.Busy) return;
            SetBusy(true, null);
            notice.text = "Checking in…";
            AccessService.Refresh(error => Finish(error, submitted: false));
        }

        private void Finish(string error, bool submitted)
        {
            SetBusy(false, null);
            if (error == null)
            {
                Pass();
                return;
            }
            if (submitted)
            {
                field.SetError(AccessMessages.ForError(error));
                FocusField();
            }
            else
            {
                bool ended = AccessMessages.EndsAccess(error);
                notice.text = ended ? AccessMessages.ForError(error) : $"{AccessMessages.ForError(error)} Or enter your code.";
                retry.SetShown(!ended);
            }
        }

        private void SetBusy(bool busy, string label)
        {
            submit.SetEnabled(!busy);
            retry.SetEnabled(!busy);
            SetLabel(submit, busy && label != null ? label : "Start playing");
        }

        // Ds.Button draws its text in a child label (setting .text would draw a second one).
        private static void SetLabel(Button button, string text)
        {
            Label label = button.Q<Label>(className: "ds-btn__label");
            if (label != null) label.text = text;
        }

        private void Pass()
        {
            gate.RemoveFromHierarchy();
            if (Current == this) Current = null;
            SetTitleShown(true);
            passed?.Invoke();
        }
    }
}
