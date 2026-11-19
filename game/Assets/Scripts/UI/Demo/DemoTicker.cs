using UnityEngine;

namespace RingsideBooker.UI.Demo
{
    /// <summary>Runs the demo's advances on the frame clock (survives scene loads).</summary>
    public sealed class DemoTicker : MonoBehaviour
    {
        public DemoGame Game { get; set; }

        private void Update() => Game?.Tick(Time.unscaledDeltaTime);
    }
}
