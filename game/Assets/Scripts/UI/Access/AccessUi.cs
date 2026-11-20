using System;
using System.Globalization;
using RingsideBooker.Release.Access;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Access
{
    /// <summary>
    /// Settings › About (POL9-12): "Tester access: active (RB-7K3M-••••)", how long it works offline,
    /// and Remove this code. Shown only on builds the gate applies to (or when a licence is stored).
    /// Elements: <c>settings-access</c>, <c>access-status</c>, <c>access-detail</c>, <c>access-remove</c>.
    /// </summary>
    public static class AccessUi
    {
        public static VisualElement AboutBlock()
        {
            VisualElement block = Ui.El("acc-about").Named("settings-access");
            block.RegisterCallback<AttachToPanelEvent>(evt => AccessGate.Apply(evt.destinationPanel?.visualTree));
            if (!AccessService.AppliesToBuild)
            {
                block.SetShown(false);
                return block;
            }

            Label status = Ds.Text(string.Empty, "t-data", "acc-about__status").Named("access-status");
            Label detail = Ds.Text(string.Empty, "field-hint", "acc-about__detail").Named("access-detail");
            Button remove = Ds.Button("Remove this code", null, DsButtonKind.Ghost);
            remove.name = "access-remove";
            remove.AddToClassList("acc-about__remove");
            remove.clicked += () => ConfirmRemove(remove);
            block.Add(status);
            block.Add(detail);
            block.Add(remove);

            void Refresh()
            {
                string line = AccessService.StatusLine();
                status.text = line ?? "Tester access: no code on this computer";
                AccessVerdict verdict = AccessService.Check(out LicencePayload payload);
                detail.text = DetailText(verdict, payload, DateTime.UtcNow);
                detail.SetShown(!string.IsNullOrEmpty(detail.text));
                remove.SetShown(payload != null);
            }

            Action handler = Refresh;
            block.RegisterCallback<AttachToPanelEvent>(_ =>
            {
                AccessService.Changed -= handler;
                AccessService.Changed += handler;
                Refresh();
            });
            block.RegisterCallback<DetachFromPanelEvent>(_ => AccessService.Changed -= handler);
            Refresh();
            return block;
        }

        /// <summary>The quiet line under the status.</summary>
        public static string DetailText(AccessVerdict verdict, LicencePayload payload, DateTime nowUtc)
        {
            if (payload == null) return "The game will ask for a tester code the next time it starts.";
            if (verdict != AccessVerdict.Active) return "The game will check your code online the next time it starts.";
            string until = payload.ExpiresUtc.ToLocalTime().ToString("d MMM yyyy", CultureInfo.InvariantCulture);
            return $"Works offline until {until}. The game checks back once a week when you're online.";
        }

        private static void ConfirmRemove(VisualElement anchor)
        {
            Label body = Ds.Text("This computer forgets your tester code. The game will ask for it the next time it starts, and your saves stay as they are.", "acc-confirm");
            // The last button is the default, so Enter keeps the code.
            var handle = DsOverlay.Modal(anchor, "Remove this code?", body,
                ("Remove", DsButtonKind.Danger, AccessService.Remove),
                ("Keep it", DsButtonKind.Ghost, null));
            if (handle == null) AccessService.Remove();
        }
    }
}
