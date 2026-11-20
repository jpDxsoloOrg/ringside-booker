using System;
using System.Text;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace RingsideBooker.Release.Access
{
    /// <summary>The service's answer: a token, or an error name (<see cref="AccessMessages.ForError"/>).</summary>
    public sealed class AccessReply
    {
        public string Token;
        public string Error;

        public bool Ok => Error == null && !string.IsNullOrEmpty(Token);

        public static AccessReply Failed(string error) => new AccessReply { Error = error };

        /// <summary>Reads a response body; a body that isn't the service's JSON is a server fault (or the network for no body).</summary>
        public static AccessReply Parse(long status, string body)
        {
            if (string.IsNullOrEmpty(body)) return Failed(status == 0 ? AccessMessages.Network : "server_error");
            try
            {
                JObject json = JObject.Parse(body);
                if (json.Value<bool?>("ok") == true && !string.IsNullOrEmpty(json.Value<string>("token")))
                {
                    return new AccessReply { Token = json.Value<string>("token") };
                }
                string error = json.Value<string>("error");
                // API Gateway's own throttle answers {"message":"Too Many Requests"} with a 429.
                if (string.IsNullOrEmpty(error)) error = status == 429 ? "rate_limited" : "server_error";
                return Failed(error);
            }
            catch (Exception)
            {
                return Failed(status == 429 ? "rate_limited" : "server_error");
            }
        }
    }

    public interface IAccessClient
    {
        void Activate(string code, string installId, string buildChannel, Action<AccessReply> done);
        void Refresh(string token, Action<AccessReply> done);
    }

    /// <summary>
    /// POSTs to the access service with UnityWebRequest (the main thread gets the answer). It sends
    /// only the code, the random install id and the build's channel, with a generic User-Agent.
    /// </summary>
    public sealed class HttpAccessClient : IAccessClient
    {
        public const int TimeoutSeconds = 15;

        private readonly string baseUrl;

        public HttpAccessClient(string baseUrl)
        {
            this.baseUrl = (baseUrl ?? "").TrimEnd('/');
        }

        public void Activate(string code, string installId, string buildChannel, Action<AccessReply> done) =>
            Post("/activate", new JObject { ["code"] = code, ["installId"] = installId, ["channel"] = buildChannel }, done);

        public void Refresh(string token, Action<AccessReply> done) =>
            Post("/refresh", new JObject { ["token"] = token }, done);

        private void Post(string path, JObject body, Action<AccessReply> done)
        {
            UnityWebRequest request;
            try
            {
                request = new UnityWebRequest(baseUrl + path, UnityWebRequest.kHttpVerbPOST)
                {
                    uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body.ToString(Newtonsoft.Json.Formatting.None))),
                    downloadHandler = new DownloadHandlerBuffer(),
                    timeout = TimeoutSeconds,
                };
                request.SetRequestHeader("Content-Type", "application/json");
                request.SetRequestHeader("User-Agent", "RingsideBooker");
            }
            catch (Exception error)
            {
                Debug.Log($"[Access] request not started: {error.GetType().Name}");
                done(AccessReply.Failed(AccessMessages.Network));
                return;
            }
            request.SendWebRequest().completed += _ =>
            {
                AccessReply reply;
                if (request.result == UnityWebRequest.Result.ConnectionError)
                {
                    reply = AccessReply.Failed(AccessMessages.Network);
                }
                else
                {
                    reply = AccessReply.Parse(request.responseCode, request.downloadHandler?.text);
                }
                Debug.Log($"[Access] {path}: {(reply.Ok ? "ok" : reply.Error)} (HTTP {request.responseCode})");
                request.Dispose();
                done(reply);
            };
        }
    }
}
