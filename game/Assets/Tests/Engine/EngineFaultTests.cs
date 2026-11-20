using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace RingsideBooker.Engine.Tests
{
    /// <summary>
    /// UNITY-24 fault routing on a tiny stand-in bundle (no engine build needed): a throw inside V8
    /// stops the client once, raises OnFault with the call's name, and every later call fails with
    /// EngineStoppedException; a reader failing on a well-formed answer does not stop it.
    /// </summary>
    public sealed class EngineFaultTests
    {
        private const string FakeBundle = @"
globalThis.RingsideEngine = {
  info: function () { return JSON.stringify({ engineVersion: 'fake', hostApiVersion: 3, saveFormatVersion: 1, schemaFingerprint: 'fake', worldLoaded: false, revision: 0 }); },
  query: function (name) { return JSON.stringify({ revision: 1, result: { ok: true, data: name === 'odd' ? 'not an object' : {} } }); }
};";

        private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);
        private string bundlePath;

        [SetUp]
        public void WriteBundle()
        {
            bundlePath = Path.Combine(Path.GetTempPath(), "rb-fault-test-" + Guid.NewGuid().ToString("N") + ".js");
            File.WriteAllText(bundlePath, FakeBundle);
        }

        [TearDown]
        public void DeleteBundle()
        {
            if (File.Exists(bundlePath)) File.Delete(bundlePath);
        }

        [Test]
        public void AThrowInsideV8StopsTheClientAndRefusesLaterCalls()
        {
            var client = new EngineClient(bundlePath, new InlineContext());
            try
            {
                Assert.IsTrue(client.Ready.Wait(Timeout), "the stand-in bundle loads");
                EngineFault raised = null;
                int raisedCount = 0;
                client.OnFault += fault =>
                {
                    raised = fault;
                    Interlocked.Increment(ref raisedCount);
                };

                LogAssert.Expect(LogType.Error, new Regex("The engine stopped during 'dev forceFault'"));
                Task<bool> forced = client.ForceFaultForTesting();
                AggregateException error = Assert.Throws<AggregateException>(() => forced.Wait(Timeout));
                Assert.IsTrue(EngineFault.IsFatal(error.InnerException), "the original error is a fatal one: " + error.InnerException);

                Assert.IsTrue(client.IsStopped);
                Assert.IsNotNull(raised, "OnFault raised");
                Assert.AreEqual(1, raisedCount);
                Assert.AreEqual("dev forceFault", raised.Call);
                StringAssert.Contains("Engine fault forced for testing", raised.Message);
                Assert.AreSame(raised, client.Fault);

                Task<QueryResult<Newtonsoft.Json.Linq.JToken>> later = client.Query("sim.status");
                AggregateException refused = Assert.Throws<AggregateException>(() => later.Wait(Timeout));
                Assert.IsInstanceOf<EngineStoppedException>(refused.InnerException);
                Assert.AreSame(raised, ((EngineStoppedException)refused.InnerException).Fault);
                Assert.AreEqual(1, raisedCount, "raised once");
            }
            finally
            {
                client.Dispose();
            }
        }

        [Test]
        public void AReaderFailingOnAWellFormedAnswerDoesNotStopTheEngine()
        {
            var client = new EngineClient(bundlePath, new InlineContext());
            try
            {
                Assert.IsTrue(client.Ready.Wait(Timeout));
                bool raised = false;
                client.OnFault += _ => raised = true;

                Task<QueryResult<ClockView>> odd = client.Query<ClockView>("odd");
                Assert.Throws<AggregateException>(() => odd.Wait(Timeout));
                Assert.IsFalse(client.IsStopped);
                Assert.IsFalse(raised);

                Task<QueryResult<Newtonsoft.Json.Linq.JToken>> next = client.Query("fine");
                Assert.IsTrue(next.Wait(Timeout));
                Assert.IsTrue(next.Result.Ok, "the client still answers");
            }
            finally
            {
                client.Dispose();
            }
        }

        [Test]
        public void FaultClassification()
        {
            Assert.IsTrue(EngineFault.IsFatal(new JsEngineException("boom")));
            Assert.IsTrue(EngineFault.IsFatal(new ObjectDisposedException(nameof(JsEngineHost))));
            Assert.IsTrue(EngineFault.IsFatal(new InvalidOperationException("RingsideEngine.save did not settle: the promise job queue was not drained")));
            Assert.IsTrue(EngineFault.IsFatal(new AggregateException(new JsEngineException("inner"))));
            Assert.IsFalse(EngineFault.IsFatal(new ObjectDisposedException(nameof(EngineClient))));
            Assert.IsFalse(EngineFault.IsFatal(new OperationCanceledException()));
            Assert.IsFalse(EngineFault.IsFatal(new Newtonsoft.Json.JsonSerializationException("bad shape")));
            Assert.IsFalse(EngineFault.IsFatal(new InvalidOperationException("something else")));
            Assert.IsFalse(EngineFault.IsFatal(null));
        }

        [Test]
        public void AFaultKeepsTheRootMessageAndTheFullDetail()
        {
            var fault = new EngineFault("query sim.status", new AggregateException(new JsEngineException("V8 said no")), DateTimeOffset.UtcNow);
            Assert.AreEqual("V8 said no", fault.Message);
            Assert.AreEqual(nameof(JsEngineException), fault.Kind);
            StringAssert.Contains("V8 said no", fault.Detail);
            Assert.IsFalse(fault.AtStart);
        }

        /// <summary>Runs posted events at once, on the posting thread (no Unity main loop in a plain test).</summary>
        private sealed class InlineContext : SynchronizationContext
        {
            public override void Post(SendOrPostCallback callback, object state) => callback(state);
        }
    }
}
