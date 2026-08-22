using System.Net;
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
        Assert.Equal(created.RoomId, joined.RoomId);
        Assert.Equal("Ready", joined.RoomStatus);
        Assert.Equal(created.RoomExpiresAtUtc, joined.RoomExpiresAtUtc);
        Assert.NotEqual(Guid.Empty, joined.ParticipantId);
        Assert.NotEqual(clientSuppliedGuestId, joined.ParticipantId);
        Assert.NotEqual(created.ParticipantId, joined.ParticipantId);
        Assert.Equal("Guest", joined.Role);
        Assert.False(string.IsNullOrWhiteSpace(joined.Credential));
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

    public enum RoomJoinState
    {
        Expired,
        Closed,
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
