using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Duovie.Application.IceServers;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Duovie.Infrastructure.IceServers;

/// <summary>
/// Generates short-lived Cloudflare Realtime TURN credentials. The long-lived
/// <see cref="CloudflareTurnOptions.ApiToken"/> and <see cref="CloudflareTurnOptions.KeyId"/>
/// never leave this class; only the short-lived, provider-neutral result is returned.
/// A provider failure degrades to an empty result rather than throwing, so it never takes
/// down the Room Hub/session or an otherwise viable direct P2P connection.
/// </summary>
public sealed class CloudflareTurnCredentialProvider(
    HttpClient httpClient,
    IOptions<CloudflareTurnOptions> options,
    ILogger<CloudflareTurnCredentialProvider> logger)
{
    private const int MaximumUrlCount = 8;
    private const int MaximumUrlLength = 512;
    private const int MaximumCredentialLength = 512;
    private static readonly string[] AllowedSchemes = ["stun:", "turn:", "turns:"];

    private readonly HttpClient _httpClient = httpClient
        ?? throw new ArgumentNullException(nameof(httpClient));

    private readonly CloudflareTurnOptions _options = options?.Value
        ?? throw new ArgumentNullException(nameof(options));

    private readonly ILogger<CloudflareTurnCredentialProvider> _logger = logger
        ?? throw new ArgumentNullException(nameof(logger));

    public async Task<IReadOnlyList<IceServerDescriptor>> GetTurnServersAsync(
        CancellationToken cancellationToken = default)
    {
        if (!_options.Enabled)
        {
            return [];
        }

        try
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Post,
                $"v1/turn/keys/{_options.KeyId}/credentials/generate-ice-servers")
            {
                Content = JsonContent.Create(new { ttl = _options.CredentialTtlSeconds }),
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiToken);

            using var response = await _httpClient.SendAsync(request, cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Cloudflare TURN credential generation failed with status {StatusCode}.",
                    (int)response.StatusCode);
                return [];
            }

            var payload = await response.Content.ReadFromJsonAsync<CloudflareIceServersResponse>(
                cancellationToken);
            var descriptor = Validate(payload);

            if (descriptor is null)
            {
                _logger.LogWarning("Cloudflare TURN credential response failed validation.");
                return [];
            }

            return [descriptor];
        }
        catch (Exception exception) when (exception is HttpRequestException or JsonException)
        {
            _logger.LogWarning(exception, "Cloudflare TURN credential generation failed.");
            return [];
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // The caller's own token was not cancelled, so this is our configured
            // HttpClient.Timeout firing, not an aborted request. Degrade quietly; do not
            // let a genuinely cancelled request reach here and be logged as a failure.
            _logger.LogWarning("Cloudflare TURN credential generation timed out.");
            return [];
        }
    }

    private static IceServerDescriptor? Validate(CloudflareIceServersResponse? response)
    {
        if (response?.IceServers?.Urls is not { Count: > 0 and <= MaximumUrlCount } urls)
        {
            return null;
        }

        var validatedUrls = new List<string>(urls.Count);
        var requiresCredential = false;

        foreach (var url in urls)
        {
            if (string.IsNullOrWhiteSpace(url) || url.Length > MaximumUrlLength)
            {
                return null;
            }

            var scheme = Array.Find(
                AllowedSchemes,
                candidate => url.StartsWith(candidate, StringComparison.OrdinalIgnoreCase));

            if (scheme is null)
            {
                return null;
            }

            if (scheme is "turn:" or "turns:")
            {
                requiresCredential = true;
            }

            validatedUrls.Add(url);
        }

        var entry = response.IceServers;

        if (requiresCredential && !HasUsableCredential(entry.Username, entry.Credential))
        {
            return null;
        }

        return new IceServerDescriptor(validatedUrls, entry.Username, entry.Credential);
    }

    private static bool HasUsableCredential(string? username, string? credential)
    {
        return !string.IsNullOrWhiteSpace(username)
            && username.Length <= MaximumCredentialLength
            && !string.IsNullOrWhiteSpace(credential)
            && credential.Length <= MaximumCredentialLength;
    }
}
