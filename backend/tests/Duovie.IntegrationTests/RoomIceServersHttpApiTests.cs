using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Duovie.Application.ParticipantSessions;
using Duovie.Domain.Rooms;
using Duovie.Infrastructure.Persistence.Repositories;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Duovie.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class RoomIceServersHttpApiTests : IDisposable
{
    private static readonly TimeSpan SessionLifetime = TimeSpan.FromMinutes(30);
    private readonly PostgreSqlFixture _fixture;
    private readonly PostgreSqlDuovieApiFactory _factory;
    private readonly HttpClient _client;

    public RoomIceServersHttpApiTests(PostgreSqlFixture fixture)
    {
        _fixture = fixture;
        _factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        _client = CreateClient(_factory);
    }

    [Fact]
    public async Task Host_can_obtain_ICE_configuration()
    {
        var created = await CreateRoomAsync(_client);

        using var response = await RequestIceServersAsync(_client, created.RoomId, created.Credential);
        var body = await ReadIceServersAsync(response);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertCacheControlNoStore(response);
        Assert.NotNull(body.IceServers);
    }

    [Fact]
    public async Task Guest_can_obtain_ICE_configuration()
    {
        var created = await CreateRoomAsync(_client);
        var joined = await JoinRoomAsync(_client, created.RoomId);

        using var response = await RequestIceServersAsync(_client, joined.RoomId, joined.Credential);
        var body = await ReadIceServersAsync(response);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertCacheControlNoStore(response);
        Assert.NotNull(body.IceServers);
    }

    [Theory]
    [InlineData(IceServersCredentialCase.Missing)]
    [InlineData(IceServersCredentialCase.WrongScheme)]
    [InlineData(IceServersCredentialCase.Malformed)]
    [InlineData(IceServersCredentialCase.Unknown)]
    public async Task Missing_malformed_and_unknown_credentials_are_rejected(
        IceServersCredentialCase credentialCase)
    {
        var created = await CreateRoomAsync(_client);
        var authorization = credentialCase switch
        {
            IceServersCredentialCase.Missing => null,
            IceServersCredentialCase.WrongScheme => "Basic opaque-value",
            IceServersCredentialCase.Malformed => "Bearer not-a-valid-credential",
            IceServersCredentialCase.Unknown => $"Bearer {new string('A', 43)}",
            _ => throw new ArgumentOutOfRangeException(nameof(credentialCase)),
        };

        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/rooms/{created.RoomId}/ice-servers");
        if (authorization is not null)
        {
            request.Headers.TryAddWithoutValidation("Authorization", authorization);
        }

        using var response = await _client.SendAsync(request);

        AssertCacheControlNoStore(response);
        await AssertSafeUnauthorizedAsync(response, created.Credential);
    }

    [Fact]
    public async Task Expired_credential_is_rejected()
    {
        var created = await CreateRoomAsync(_client);
        using var expiredFactory = new PostgreSqlDuovieApiFactory(
            _fixture.ConnectionString,
            timeProvider: new TestTimeProvider(
                PostgreSqlDuovieApiFactory.UtcNow.Add(SessionLifetime).AddSeconds(1)));
        using var expiredClient = CreateClient(expiredFactory);

        using var response = await RequestIceServersAsync(expiredClient, created.RoomId, created.Credential);

        AssertCacheControlNoStore(response);
        await AssertSafeUnauthorizedAsync(response, created.Credential);
    }

    [Fact]
    public async Task Credential_for_one_Room_is_rejected_for_another_Room()
    {
        var firstRoom = await CreateRoomAsync(_client);
        var secondRoom = await CreateRoomAsync(_client);

        using var response = await RequestIceServersAsync(_client, secondRoom.RoomId, firstRoom.Credential);

        AssertCacheControlNoStore(response);
        await AssertSafeUnauthorizedAsync(response, firstRoom.Credential, secondRoom.Credential);
    }

    [Fact]
    public async Task Closed_Room_is_rejected()
    {
        var created = await CreateRoomAsync(_client);
        await using (var dbContext = _fixture.CreateDbContext())
        {
            var room = await dbContext.Rooms.SingleAsync(room => room.Id == created.RoomId);
            room.Close(PostgreSqlDuovieApiFactory.UtcNow);
            await dbContext.SaveChangesAsync();
        }

        using var response = await RequestIceServersAsync(_client, created.RoomId, created.Credential);

        AssertCacheControlNoStore(response);
        await AssertSafeUnauthorizedAsync(response, created.Credential);
    }

    [Fact]
    public async Task Expired_Room_is_rejected_even_with_a_still_valid_session()
    {
        var hostId = Guid.NewGuid();
        var room = Room.Create(
            Guid.NewGuid(),
            hostId,
            PostgreSqlDuovieApiFactory.UtcNow,
            PostgreSqlDuovieApiFactory.UtcNow.AddMinutes(10));
        await using (var dbContext = _fixture.CreateDbContext())
        {
            var repository = new RoomRepository(dbContext);
            await repository.AddAsync(room);
            await repository.SaveChangesAsync();
        }

        IssuedParticipantSession issued;
        using (var scope = _factory.Services.CreateScope())
        {
            var sessionService = scope.ServiceProvider
                .GetRequiredService<ParticipantSessionService>();
            issued = await sessionService.IssueAsync(
                room.Id,
                hostId,
                ParticipantRole.Host);
        }

        using var expiredRoomFactory = new PostgreSqlDuovieApiFactory(
            _fixture.ConnectionString,
            timeProvider: new TestTimeProvider(PostgreSqlDuovieApiFactory.UtcNow.AddMinutes(11)));
        using var expiredRoomClient = CreateClient(expiredRoomFactory);
        using var response = await RequestIceServersAsync(expiredRoomClient, room.Id, issued.Credential);

        AssertCacheControlNoStore(response);
        await AssertSafeUnauthorizedAsync(response, issued.Credential);
    }

    [Fact]
    public async Task Client_supplied_role_and_participant_overrides_are_ignored()
    {
        var created = await CreateRoomAsync(_client);
        var hostileParticipantId = Guid.NewGuid();
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/rooms/{created.RoomId}/ice-servers?role=Guest&participantId={hostileParticipantId}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", created.Credential);

        using var response = await _client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertCacheControlNoStore(response);
    }

    [Fact]
    public async Task No_database_mutation_is_performed_by_ICE_configuration_retrieval()
    {
        var created = await CreateRoomAsync(_client);
        await using var beforeContext = _fixture.CreateDbContext();
        var roomCountBefore = await beforeContext.Rooms.CountAsync();
        var sessionCountBefore = await beforeContext.ParticipantSessions.CountAsync();

        using var response = await RequestIceServersAsync(_client, created.RoomId, created.Credential);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await using var afterContext = _fixture.CreateDbContext();
        Assert.Equal(roomCountBefore, await afterContext.Rooms.CountAsync());
        Assert.Equal(sessionCountBefore, await afterContext.ParticipantSessions.CountAsync());
    }

    [Fact]
    public async Task TURN_disabled_local_mode_works_without_Cloudflare_secrets()
    {
        var created = await CreateRoomAsync(_client);

        using var response = await RequestIceServersAsync(_client, created.RoomId, created.Credential);
        var body = await ReadIceServersAsync(response);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty(body.IceServers);
    }

    [Fact]
    public async Task Enabled_Cloudflare_TURN_maps_to_provider_neutral_iceServers_without_leaking_secrets()
    {
        const string apiToken = "super-secret-long-lived-cloudflare-token";
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            """
            {
              "iceServers": {
                "urls": ["turn:turn.cloudflare.com:3478?transport=udp"],
                "username": "short-lived-username",
                "credential": "short-lived-credential"
              }
            }
            """));
        using var enabledFactory = new PostgreSqlDuovieApiFactory(
            _fixture.ConnectionString,
            additionalConfiguration: new Dictionary<string, string?>
            {
                ["CloudflareTurn:Enabled"] = "true",
                ["CloudflareTurn:KeyId"] = "test-key-id",
                ["CloudflareTurn:ApiToken"] = apiToken,
            },
            cloudflareTurnHttpMessageHandler: handler);
        using var enabledClient = CreateClient(enabledFactory);
        var created = await CreateRoomAsync(enabledClient);

        using var response = await RequestIceServersAsync(enabledClient, created.RoomId, created.Credential);
        var rawJson = await response.Content.ReadAsStringAsync();
        var body = await ReadIceServersAsync(response);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var iceServer = Assert.Single(body.IceServers);
        Assert.Equal(["turn:turn.cloudflare.com:3478?transport=udp"], iceServer.Urls);
        Assert.Equal("short-lived-username", iceServer.Username);
        Assert.Equal("short-lived-credential", iceServer.Credential);
        Assert.DoesNotContain(apiToken, rawJson, StringComparison.Ordinal);
        Assert.DoesNotContain("test-key-id", rawJson, StringComparison.Ordinal);
        Assert.DoesNotContain(created.Credential, rawJson, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Cloudflare_TURN_provider_failure_falls_back_to_baseline_without_exposing_details()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.InternalServerError,
            "{\"error\":\"internal provider failure\"}"));
        using var enabledFactory = new PostgreSqlDuovieApiFactory(
            _fixture.ConnectionString,
            additionalConfiguration: new Dictionary<string, string?>
            {
                ["CloudflareTurn:Enabled"] = "true",
                ["CloudflareTurn:KeyId"] = "test-key-id",
                ["CloudflareTurn:ApiToken"] = "test-token",
            },
            cloudflareTurnHttpMessageHandler: handler);
        using var enabledClient = CreateClient(enabledFactory);
        var created = await CreateRoomAsync(enabledClient);

        using var response = await RequestIceServersAsync(enabledClient, created.RoomId, created.Credential);
        var rawJson = await response.Content.ReadAsStringAsync();
        var body = await ReadIceServersAsync(response);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty(body.IceServers);
        Assert.DoesNotContain("internal provider failure", rawJson, StringComparison.Ordinal);
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    private static HttpClient CreateClient(WebApplicationFactory<Program> factory)
    {
        return factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
        });
    }

    private static async Task<RoomSessionPayload> CreateRoomAsync(HttpClient client)
    {
        using var response = await client.PostAsync("/api/rooms", null);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        return await ReadSessionPayloadAsync(response);
    }

    private static async Task<RoomSessionPayload> JoinRoomAsync(HttpClient client, Guid roomId)
    {
        using var response = await client.PostAsync($"/api/rooms/{roomId}/join", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        return await ReadSessionPayloadAsync(response);
    }

    private static async Task<RoomSessionPayload> ReadSessionPayloadAsync(HttpResponseMessage response)
    {
        var rawJson = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(rawJson);
        var root = document.RootElement;
        var room = root.GetProperty("room");
        var participant = root.GetProperty("participant");

        return new RoomSessionPayload(
            room.GetProperty("id").GetGuid(),
            participant.GetProperty("credential").GetString()!);
    }

    private static Task<HttpResponseMessage> RequestIceServersAsync(
        HttpClient client,
        Guid roomId,
        string credential)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/rooms/{roomId}/ice-servers");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credential);

        return client.SendAsync(request);
    }

    private static async Task<IceServersPayload> ReadIceServersAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<IceServersPayload>();
        Assert.NotNull(body);
        return body;
    }

    private static void AssertCacheControlNoStore(HttpResponseMessage response)
    {
        Assert.NotNull(response.Headers.CacheControl);
        Assert.True(response.Headers.CacheControl.NoStore);
    }

    private static async Task AssertSafeUnauthorizedAsync(
        HttpResponseMessage response,
        params string[] credentials)
    {
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var document = JsonDocument.Parse(body);
        Assert.Equal("Participant session is invalid.", document.RootElement.GetProperty("title").GetString());
        Assert.False(body.Contains("tokenHash", StringComparison.OrdinalIgnoreCase));

        foreach (var credential in credentials)
        {
            Assert.False(
                body.Contains(credential, StringComparison.Ordinal),
                "Problem response contained a participant credential.");
        }
    }

    private sealed record RoomSessionPayload(Guid RoomId, string Credential);

    private sealed record IceServersPayload(List<IceServerPayload> IceServers);

    private sealed record IceServerPayload(List<string> Urls, string? Username, string? Credential);

    private sealed class TestTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow()
        {
            return utcNow;
        }
    }

    public enum IceServersCredentialCase
    {
        Missing,
        WrongScheme,
        Malformed,
        Unknown,
    }
}
