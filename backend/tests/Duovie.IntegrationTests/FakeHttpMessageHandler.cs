using System.Text;

namespace Duovie.IntegrationTests;

internal sealed class FakeHttpMessageHandler(
    Func<HttpRequestMessage, HttpResponseMessage>? respond = null) : HttpMessageHandler
{
    private readonly List<CapturedRequest> _requests = [];

    public IReadOnlyList<CapturedRequest> Requests => _requests;

    /// <summary>
    /// When <c>true</c>, <see cref="SendAsync"/> never completes on its own; it only
    /// observes the request's <see cref="CancellationToken"/> (e.g. the caller's own
    /// cancellation, or an <see cref="HttpClient.Timeout"/> firing). Lets tests exercise a
    /// hung/unreachable provider without waiting real wall-clock time.
    /// </summary>
    public bool Hang { get; init; }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var body = request.Content is null
            ? null
            : await request.Content.ReadAsStringAsync(cancellationToken);

        _requests.Add(new CapturedRequest(
            request.Method,
            request.RequestUri,
            request.Headers.Authorization?.ToString(),
            body));

        if (Hang)
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
        }

        return respond!(request);
    }

    public static HttpResponseMessage JsonResponse(
        System.Net.HttpStatusCode statusCode,
        string json)
    {
        return new HttpResponseMessage(statusCode)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
    }

    internal sealed record CapturedRequest(
        HttpMethod Method,
        Uri? RequestUri,
        string? Authorization,
        string? Body);
}
