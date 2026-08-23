using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Duovie.Application.ParticipantSessions;
using Duovie.Domain.Rooms;
using Duovie.Infrastructure.Persistence;
using Duovie.Infrastructure.Persistence.Repositories;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Duovie.IntegrationTests;

[Collection(PostgreSqlCollection.Name)]
public sealed class RoomHttpApiTests : IDisposable
{
    private static readonly TimeSpan RoomLifetime = TimeSpan.FromHours(2);
    private static readonly TimeSpan SessionLifetime = TimeSpan.FromMinutes(30);
    private readonly PostgreSqlFixture _fixture;
    private readonly PostgreSqlDuovieApiFactory _factory;
    private readonly HttpClient _client;

    public RoomHttpApiTests(PostgreSqlFixture fixture)
    {
        _fixture = fixture;
        _factory = new PostgreSqlDuovieApiFactory(fixture.ConnectionString);
        _client = CreateClient(_factory);
    }

    [Fact]
    public async Task Create_returns_a_server_generated_Host_session_and_persists_it()
    {
        var clientSuppliedRoomId = Guid.NewGuid();
        var clientSuppliedHostId = Guid.NewGuid();

        using var response = await _client.PostAsJsonAsync(
            "/api/rooms",
            new
            {
                roomId = clientSuppliedRoomId,
                hostId = clientSuppliedHostId,
                role = "Host",
                credential = "client-controlled",
                expiresAtUtc = PostgreSqlDuovieApiFactory.UtcNow.AddYears(10),
            });
        var payload = await ReadSessionPayloadAsync(response);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        AssertCacheControlNoStore(response);
        Assert.Null(response.Headers.Location);
        Assert.NotEqual(Guid.Empty, payload.RoomId);
        Assert.NotEqual(clientSuppliedRoomId, payload.RoomId);
        Assert.Equal("WaitingForGuest", payload.RoomStatus);
        Assert.Equal(PostgreSqlDuovieApiFactory.UtcNow.Add(RoomLifetime), payload.RoomExpiresAtUtc);
        Assert.NotEqual(Guid.Empty, payload.ParticipantId);
        Assert.NotEqual(clientSuppliedHostId, payload.ParticipantId);
        Assert.NotEqual(payload.RoomId, payload.ParticipantId);
        Assert.Equal("Host", payload.Role);
        Assert.False(string.IsNullOrWhiteSpace(payload.Credential));
        Assert.NotEqual("client-controlled", payload.Credential);
        Assert.Equal(PostgreSqlDuovieApiFactory.UtcNow.Add(SessionLifetime), payload.SessionExpiresAtUtc);
        Assert.False(payload.RawJson.Contains("tokenHash", StringComparison.OrdinalIgnoreCase));
        Assert.False(payload.RawJson.Contains("sessionId", StringComparison.OrdinalIgnoreCase));

        using var scope = _factory.Services.CreateScope();
        var sessionService = scope.ServiceProvider.GetRequiredService<ParticipantSessionService>();
        var validated = await sessionService.ValidateAsync(payload.Credential, payload.RoomId);
        var dbContext = scope.ServiceProvider.GetRequiredService<DuovieDbContext>();
        var room = await dbContext.Rooms.AsNoTracking().SingleAsync(candidate => candidate.Id == payload.RoomId);
        var session = await dbContext.ParticipantSessions
            .AsNoTracking()
            .SingleAsync(candidate => candidate.RoomId == payload.RoomId);

        Assert.Equal(payload.ParticipantId, validated.ParticipantId);
        Assert.Equal(ParticipantRole.Host, validated.Role);
        Assert.Equal(payload.ParticipantId, room.HostId);
        Assert.Equal(payload.ParticipantId, session.ParticipantId);
        Assert.Equal(ParticipantRole.Host, session.Role);
    }

    [Fact]
    public async Task Join_returns_only_the_server_generated_Guest_session_and_persists_Ready_state()
    {
        var created = await CreateRoomAsync(_client);
        var clientSuppliedGuestId = Guid.NewGuid();

        using var response = await _client.PostAsJsonAsync(
            $"/api/rooms/{created.RoomId}/join",
            new
            {
                guestId = clientSuppliedGuestId,
                role = "Host",
                credential = "client-controlled",
            });
        var joined = await ReadSessionPayloadAsync(response);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertCacheControlNoStore(response);
        Assert.Null(response.Headers.Location);
        Assert.Equal(created.RoomId, joined.RoomId);
        Assert.Equal("Ready", joined.RoomStatus);
        Assert.Equal(created.RoomExpiresAtUtc, joined.RoomExpiresAtUtc);
        Assert.NotEqual(Guid.Empty, joined.ParticipantId);
        Assert.NotEqual(clientSuppliedGuestId, joined.ParticipantId);
        Assert.NotEqual(created.ParticipantId, joined.ParticipantId);
        Assert.Equal("Guest", joined.Role);
        Assert.False(string.IsNullOrWhiteSpace(joined.Credential));
        Assert.NotEqual("client-controlled", joined.Credential);
        Assert.NotEqual(CredentialFingerprint(created.Credential), CredentialFingerprint(joined.Credential));
        Assert.False(joined.RawJson.Contains("hostId", StringComparison.OrdinalIgnoreCase));
        Assert.False(joined.RawJson.Contains("tokenHash", StringComparison.OrdinalIgnoreCase));

        using var scope = _factory.Services.CreateScope();
        var sessionService = scope.ServiceProvider.GetRequiredService<ParticipantSessionService>();
        var validated = await sessionService.ValidateAsync(joined.Credential, joined.RoomId);
        var authorizer = scope.ServiceProvider.GetRequiredService<ParticipantSessionAuthorizer>();
        await Assert.ThrowsAsync<ParticipantSessionAuthorizationException>(
            () => authorizer.RequireHostAsync(joined.Credential, joined.RoomId));
        var dbContext = scope.ServiceProvider.GetRequiredService<DuovieDbContext>();
        var room = await dbContext.Rooms.AsNoTracking().SingleAsync(candidate => candidate.Id == joined.RoomId);

        Assert.Equal(joined.ParticipantId, validated.ParticipantId);
        Assert.Equal(ParticipantRole.Guest, validated.Role);
        Assert.Equal(RoomStatus.Ready, room.Status);
        Assert.Equal(joined.ParticipantId, room.GuestId);
    }

    [Fact]
    public async Task Resume_restores_canonical_Host_and_Guest_without_secrets_or_database_mutation()
    {
        var created = await CreateRoomAsync(_client);
        var joined = await JoinRoomAsync(_client, created.RoomId);
        await using var beforeContext = _fixture.CreateDbContext();
        var roomCountBefore = await beforeContext.Rooms.CountAsync();
        var sessionCountBefore = await beforeContext.ParticipantSessions.CountAsync();

        using var hostResponse = await ResumeSessionAsync(
            _client,
            created.RoomId,
            created.Credential);
        using var guestResponse = await ResumeSessionAsync(
            _client,
            joined.RoomId,
            joined.Credential);
        var host = await ReadResumedSessionPayloadAsync(hostResponse);
        var guest = await ReadResumedSessionPayloadAsync(guestResponse);

        Assert.Equal(HttpStatusCode.OK, hostResponse.StatusCode);
        Assert.Equal(HttpStatusCode.OK, guestResponse.StatusCode);
        AssertCacheControlNoStore(hostResponse);
        AssertCacheControlNoStore(guestResponse);
        Assert.Equal(created.RoomId, host.RoomId);
        Assert.Equal(created.ParticipantId, host.ParticipantId);
        Assert.Equal("Host", host.Role);
        Assert.Equal(joined.RoomId, guest.RoomId);
        Assert.Equal(joined.ParticipantId, guest.ParticipantId);
        Assert.Equal("Guest", guest.Role);

        foreach (var payload in new[] { host.RawJson, guest.RawJson })
        {
            Assert.False(payload.Contains(created.Credential, StringComparison.Ordinal));
            Assert.False(payload.Contains(joined.Credential, StringComparison.Ordinal));
            Assert.False(payload.Contains("credential", StringComparison.OrdinalIgnoreCase));
            Assert.False(payload.Contains("tokenHash", StringComparison.OrdinalIgnoreCase));
            Assert.False(payload.Contains("sessionId", StringComparison.OrdinalIgnoreCase));
            Assert.False(payload.Contains("connectionId", StringComparison.OrdinalIgnoreCase));
        }

        await using var afterContext = _fixture.CreateDbContext();
        Assert.Equal(roomCountBefore, await afterContext.Rooms.CountAsync());
        Assert.Equal(sessionCountBefore, await afterContext.ParticipantSessions.CountAsync());
        var persistedRoom = await afterContext.Rooms
            .AsNoTracking()
            .SingleAsync(room => room.Id == created.RoomId);
        Assert.Equal(RoomStatus.Ready, persistedRoom.Status);
        Assert.Equal(created.ParticipantId, persistedRoom.HostId);
        Assert.Equal(joined.ParticipantId, persistedRoom.GuestId);
    }

    [Theory]
    [InlineData(ResumeCredentialCase.Missing)]
    [InlineData(ResumeCredentialCase.WrongScheme)]
    [InlineData(ResumeCredentialCase.Malformed)]
    [InlineData(ResumeCredentialCase.Unknown)]
    public async Task Missing_malformed_and_unknown_credentials_cannot_resume(
        ResumeCredentialCase credentialCase)
    {
        var created = await CreateRoomAsync(_client);
        var authorization = credentialCase switch
        {
            ResumeCredentialCase.Missing => null,
            ResumeCredentialCase.WrongScheme => "Basic opaque-value",
            ResumeCredentialCase.Malformed => "Bearer not-a-valid-credential",
            ResumeCredentialCase.Unknown => $"Bearer {new string('A', 43)}",
            _ => throw new ArgumentOutOfRangeException(nameof(credentialCase)),
        };

        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/rooms/{created.RoomId}/session");
        if (authorization is not null)
        {
            request.Headers.TryAddWithoutValidation("Authorization", authorization);
        }

        using var response = await _client.SendAsync(request);

        AssertCacheControlNoStore(response);
        await AssertSafeProblemAsync(
            response,
            HttpStatusCode.Unauthorized,
            "Participant session is invalid.",
            created.Credential);
    }

    [Fact]
    public async Task Expired_credential_cannot_resume()
    {
        var created = await CreateRoomAsync(_client);
        using var expiredFactory = new PostgreSqlDuovieApiFactory(
            _fixture.ConnectionString,
            timeProvider: new TestTimeProvider(
                PostgreSqlDuovieApiFactory.UtcNow.Add(SessionLifetime).AddSeconds(1)));
        using var expiredClient = CreateClient(expiredFactory);

        using var response = await ResumeSessionAsync(
            expiredClient,
            created.RoomId,
            created.Credential);

        AssertCacheControlNoStore(response);
        await AssertSafeProblemAsync(
            response,
            HttpStatusCode.Unauthorized,
            "Participant session is invalid.",
            created.Credential);
    }

    [Fact]
    public async Task Credential_for_one_Room_cannot_resume_another_Room()
    {
        var firstRoom = await CreateRoomAsync(_client);
        var secondRoom = await CreateRoomAsync(_client);

        using var response = await ResumeSessionAsync(
            _client,
            secondRoom.RoomId,
            firstRoom.Credential);

        AssertCacheControlNoStore(response);
        await AssertSafeProblemAsync(
            response,
            HttpStatusCode.Unauthorized,
            "Participant session is invalid.",
            firstRoom.Credential,
            secondRoom.Credential);
    }

    [Fact]
    public async Task Resume_ignores_client_role_and_participant_identity_overrides()
    {
        var created = await CreateRoomAsync(_client);
        var hostileParticipantId = Guid.NewGuid();
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/rooms/{created.RoomId}/session?role=Guest&participantId={hostileParticipantId}");
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            created.Credential);

        using var response = await _client.SendAsync(request);
        var resumed = await ReadResumedSessionPayloadAsync(response);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(created.ParticipantId, resumed.ParticipantId);
        Assert.NotEqual(hostileParticipantId, resumed.ParticipantId);
        Assert.Equal("Host", resumed.Role);
        AssertCacheControlNoStore(response);
    }

    [Fact]
    public async Task Closed_Room_cannot_be_resumed_by_an_existing_session()
    {
        var created = await CreateRoomAsync(_client);
        await using (var dbContext = _fixture.CreateDbContext())
        {
            var room = await dbContext.Rooms.SingleAsync(room => room.Id == created.RoomId);
            room.Close(PostgreSqlDuovieApiFactory.UtcNow);
            await dbContext.SaveChangesAsync();
        }

        using var response = await ResumeSessionAsync(
            _client,
            created.RoomId,
            created.Credential);

        AssertCacheControlNoStore(response);
        await AssertSafeProblemAsync(
            response,
            HttpStatusCode.Unauthorized,
            "Participant session is invalid.",
            created.Credential);
    }

    [Fact]
    public async Task Expired_Room_cannot_be_resumed_by_a_still_valid_session()
    {
        var hostId = Guid.NewGuid();
        var room = Room.Create(
            Guid.NewGuid(),
            hostId,
            PostgreSqlDuovieApiFactory.UtcNow,
            PostgreSqlDuovieApiFactory.UtcNow.AddMinutes(10));
        await SaveRoomAsync(room);
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
            timeProvider: new TestTimeProvider(
                PostgreSqlDuovieApiFactory.UtcNow.AddMinutes(11)));
        using var expiredRoomClient = CreateClient(expiredRoomFactory);
        using var response = await ResumeSessionAsync(
            expiredRoomClient,
            room.Id,
            issued.Credential);

        AssertCacheControlNoStore(response);
        await AssertSafeProblemAsync(
            response,
            HttpStatusCode.Unauthorized,
            "Participant session is invalid.",
            issued.Credential);
    }

    [Fact]
    public async Task Second_join_returns_a_safe_conflict_without_creating_another_session()
    {
        var created = await CreateRoomAsync(_client);
        var joined = await JoinRoomAsync(_client, created.RoomId);

        using var response = await _client.PostAsync($"/api/rooms/{created.RoomId}/join", null);

        await AssertSafeProblemAsync(
            response,
            HttpStatusCode.Conflict,
            "Room cannot be joined.",
            created.Credential,
            joined.Credential);

        await using var dbContext = _fixture.CreateDbContext();
        var guestSessions = await dbContext.ParticipantSessions
            .AsNoTracking()
            .Where(session => session.RoomId == created.RoomId && session.Role == ParticipantRole.Guest)
            .ToListAsync();

        Assert.Single(guestSessions);
        Assert.Equal(joined.ParticipantId, guestSessions[0].ParticipantId);
    }

    [Theory]
    [InlineData(RoomJoinState.Expired)]
    [InlineData(RoomJoinState.Closed)]
    public async Task Unavailable_Room_join_returns_a_safe_conflict_without_a_session(
        RoomJoinState state)
    {
        var room = CreateUnavailableRoom(state);
        await SaveRoomAsync(room);

        using var response = await _client.PostAsync($"/api/rooms/{room.Id}/join", null);

        await AssertSafeProblemAsync(
            response,
            HttpStatusCode.Conflict,
            "Room cannot be joined.");

        await using var dbContext = _fixture.CreateDbContext();
        var sessions = await dbContext.ParticipantSessions
            .AsNoTracking()
            .Where(session => session.RoomId == room.Id)
            .ToListAsync();

        Assert.Empty(sessions);
    }

    [Fact]
    public async Task Missing_Room_join_returns_a_safe_not_found_problem()
    {
        using var response = await _client.PostAsync($"/api/rooms/{Guid.NewGuid()}/join", null);

        await AssertSafeProblemAsync(
            response,
            HttpStatusCode.NotFound,
            "Room not found.");
    }

    [Fact]
    public async Task Empty_Room_identifier_is_safely_treated_as_a_missing_Room()
    {
        using var response = await _client.PostAsync($"/api/rooms/{Guid.Empty}/join", null);

        await AssertSafeProblemAsync(
            response,
            HttpStatusCode.NotFound,
            "Room not found.");
    }

    [Fact]
    public async Task Malformed_Room_identifier_returns_validation_problem_details()
    {
        using var response = await _client.PostAsync("/api/rooms/not-a-guid/join", null);
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.False(body.Contains("Npgsql", StringComparison.OrdinalIgnoreCase));
        Assert.False(body.Contains("tokenHash", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Concurrent_joins_return_one_success_and_one_safe_conflict_with_one_Guest_session()
    {
        using var factory = new PostgreSqlDuovieApiFactory(
            _fixture.ConnectionString,
            coordinateTwoRoomLoads: true);
        using var client = CreateClient(factory);
        var created = await CreateRoomAsync(client);

        var responses = await Task.WhenAll(
            client.PostAsync($"/api/rooms/{created.RoomId}/join", null),
            client.PostAsync($"/api/rooms/{created.RoomId}/join", null));

        try
        {
            var success = Assert.Single(responses, response => response.StatusCode == HttpStatusCode.OK);
            var conflict = Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Conflict);
            var joined = await ReadSessionPayloadAsync(success);
            await AssertSafeProblemAsync(
                conflict,
                HttpStatusCode.Conflict,
                "Room state conflict.",
                created.Credential,
                joined.Credential);

            await using var dbContext = _fixture.CreateDbContext();
            var room = await dbContext.Rooms.AsNoTracking().SingleAsync(candidate => candidate.Id == created.RoomId);
            var guestSessions = await dbContext.ParticipantSessions
                .AsNoTracking()
                .Where(session => session.RoomId == created.RoomId && session.Role == ParticipantRole.Guest)
                .ToListAsync();

            Assert.Equal(RoomStatus.Ready, room.Status);
            Assert.Equal(joined.ParticipantId, room.GuestId);
            Assert.Single(guestSessions);
            Assert.Equal(joined.ParticipantId, guestSessions[0].ParticipantId);

            using var scope = factory.Services.CreateScope();
            var sessionService = scope.ServiceProvider.GetRequiredService<ParticipantSessionService>();
            var validated = await sessionService.ValidateAsync(joined.Credential, created.RoomId);
            Assert.Equal(joined.ParticipantId, validated.ParticipantId);
            Assert.Equal(ParticipantRole.Guest, validated.Role);
        }
        finally
        {
            foreach (var response in responses)
            {
                response.Dispose();
            }
        }
    }

    [Fact]
    public async Task Unexpected_Room_repository_failure_during_join_returns_safe_500_and_rolls_back()
    {
        var created = await CreateRoomAsync(_client);
        using var factory = new PostgreSqlDuovieApiFactory(
            _fixture.ConnectionString,
            failRoomSave: true);
        using var client = CreateClient(factory);

        using var response = await client.PostAsync($"/api/rooms/{created.RoomId}/join", null);
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.False(body.Contains("Simulated Room persistence failure", StringComparison.Ordinal));
        Assert.False(body.Contains(created.Credential, StringComparison.Ordinal));
        Assert.False(body.Contains("tokenHash", StringComparison.OrdinalIgnoreCase));
        Assert.False(body.Contains("stackTrace", StringComparison.OrdinalIgnoreCase));

        await using var dbContext = _fixture.CreateDbContext();
        var room = await dbContext.Rooms.AsNoTracking().SingleAsync(candidate => candidate.Id == created.RoomId);
        var sessions = await dbContext.ParticipantSessions
            .AsNoTracking()
            .Where(session => session.RoomId == created.RoomId)
            .ToListAsync();

        Assert.Null(room.GuestId);
        Assert.Equal(RoomStatus.WaitingForGuest, room.Status);
        Assert.Single(sessions);
        Assert.Equal(ParticipantRole.Host, sessions[0].Role);
    }

    [Fact]
    public async Task Unsupported_Room_operations_are_not_routable()
    {
        var roomId = Guid.NewGuid();
        using var getResponse = await _client.GetAsync($"/api/rooms/{roomId}");
        using var deleteResponse = await _client.DeleteAsync($"/api/rooms/{roomId}");
        using var closeResponse = await _client.PostAsync($"/api/rooms/{roomId}/close", null);

        Assert.Equal(HttpStatusCode.NotFound, getResponse.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, deleteResponse.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, closeResponse.StatusCode);
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    private async Task SaveRoomAsync(Room room)
    {
        await using var dbContext = _fixture.CreateDbContext();
        var repository = new RoomRepository(dbContext);
        await repository.AddAsync(room);
        await repository.SaveChangesAsync();
    }

    private static Room CreateUnavailableRoom(RoomJoinState state)
    {
        var nowUtc = PostgreSqlDuovieApiFactory.UtcNow;
        var room = state switch
        {
            RoomJoinState.Expired => Room.Create(
                Guid.NewGuid(),
                Guid.NewGuid(),
                nowUtc.AddHours(-2),
                nowUtc.AddMinutes(-1)),
            RoomJoinState.Closed => Room.Create(
                Guid.NewGuid(),
                Guid.NewGuid(),
                nowUtc.AddHours(-1),
                nowUtc.AddHours(1)),
            _ => throw new ArgumentOutOfRangeException(nameof(state)),
        };

        if (state == RoomJoinState.Closed)
        {
            room.Close(nowUtc.AddMinutes(-30));
        }

        return room;
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
        AssertCacheControlNoStore(response);

        return await ReadSessionPayloadAsync(response);
    }

    private static async Task<RoomSessionPayload> JoinRoomAsync(HttpClient client, Guid roomId)
    {
        using var response = await client.PostAsync($"/api/rooms/{roomId}/join", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertCacheControlNoStore(response);

        return await ReadSessionPayloadAsync(response);
    }

    private static async Task<HttpResponseMessage> ResumeSessionAsync(
        HttpClient client,
        Guid roomId,
        string credential)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/rooms/{roomId}/session");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credential);

        return await client.SendAsync(request);
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
            room.GetProperty("status").GetString()!,
            room.GetProperty("expiresAtUtc").GetDateTimeOffset(),
            participant.GetProperty("id").GetGuid(),
            participant.GetProperty("role").GetString()!,
            participant.GetProperty("credential").GetString()!,
            participant.GetProperty("expiresAtUtc").GetDateTimeOffset(),
            rawJson);
    }

    private static async Task<ResumedRoomSessionPayload> ReadResumedSessionPayloadAsync(
        HttpResponseMessage response)
    {
        var rawJson = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(rawJson);
        var root = document.RootElement;
        var room = root.GetProperty("room");
        var participant = root.GetProperty("participant");

        Assert.Equal(
            ["participant", "room"],
            root.EnumerateObject()
                .Select(property => property.Name)
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToArray());
        Assert.Equal(
            ["id"],
            room.EnumerateObject()
                .Select(property => property.Name)
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToArray());
        Assert.Equal(
            ["id", "role"],
            participant.EnumerateObject()
                .Select(property => property.Name)
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToArray());

        return new ResumedRoomSessionPayload(
            room.GetProperty("id").GetGuid(),
            participant.GetProperty("id").GetGuid(),
            participant.GetProperty("role").GetString()!,
            rawJson);
    }

    private static void AssertCacheControlNoStore(HttpResponseMessage response)
    {
        Assert.NotNull(response.Headers.CacheControl);
        Assert.True(response.Headers.CacheControl.NoStore);
    }

    private static async Task AssertSafeProblemAsync(
        HttpResponseMessage response,
        HttpStatusCode expectedStatus,
        string expectedTitle,
        params string[] credentials)
    {
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(expectedStatus, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var document = JsonDocument.Parse(body);
        Assert.Equal((int)expectedStatus, document.RootElement.GetProperty("status").GetInt32());
        Assert.Equal(expectedTitle, document.RootElement.GetProperty("title").GetString());
        Assert.False(body.Contains("Npgsql", StringComparison.OrdinalIgnoreCase));
        Assert.False(body.Contains("Postgres", StringComparison.OrdinalIgnoreCase));
        Assert.False(body.Contains("tokenHash", StringComparison.OrdinalIgnoreCase));
        Assert.False(body.Contains("stackTrace", StringComparison.OrdinalIgnoreCase));

        foreach (var credential in credentials)
        {
            Assert.False(
                body.Contains(credential, StringComparison.Ordinal),
                "Problem response contained a participant credential.");
        }
    }

    private static string CredentialFingerprint(string credential)
    {
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(credential)));
    }

    private sealed record RoomSessionPayload(
        Guid RoomId,
        string RoomStatus,
        DateTimeOffset RoomExpiresAtUtc,
        Guid ParticipantId,
        string Role,
        string Credential,
        DateTimeOffset SessionExpiresAtUtc,
        string RawJson);

    private sealed record ResumedRoomSessionPayload(
        Guid RoomId,
        Guid ParticipantId,
        string Role,
        string RawJson);

    private sealed class TestTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow()
        {
            return utcNow;
        }
    }

    public enum RoomJoinState
    {
        Expired,
        Closed,
    }

    public enum ResumeCredentialCase
    {
        Missing,
        WrongScheme,
        Malformed,
        Unknown,
    }
}

public sealed class RoomHttpUnexpectedErrorTests(DuovieApiFactory factory)
    : IClassFixture<DuovieApiFactory>
{
    [Fact]
    public async Task Unexpected_database_failure_returns_safe_problem_details()
    {
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
        });

        using var response = await client.PostAsync("/api/rooms", null);
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.False(body.Contains("Npgsql", StringComparison.OrdinalIgnoreCase));
        Assert.False(body.Contains("Postgres", StringComparison.OrdinalIgnoreCase));
        Assert.False(body.Contains("127.0.0.1", StringComparison.Ordinal));
        Assert.False(body.Contains("ConnectionString", StringComparison.OrdinalIgnoreCase));
        Assert.False(body.Contains("stackTrace", StringComparison.OrdinalIgnoreCase));
    }
}
