using System.Buffers.Text;
using System.Security.Cryptography;
using Duovie.Application.ParticipantSessions;

namespace Duovie.UnitTests;

public class ParticipantSessionServiceTests
{
    private static readonly Guid RoomId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OtherRoomId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid ParticipantId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly DateTimeOffset IssuedAtUtc = new(2026, 8, 22, 12, 0, 0, TimeSpan.Zero);
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(30);

    [Fact]
    public async Task IssueAsync_returns_an_opaque_Base64Url_credential_and_persists_only_its_hash()
    {
        var store = new ParticipantSessionStoreSpy();
        var service = CreateService(store);

        var issued = await service.IssueAsync(RoomId, ParticipantId, ParticipantRole.Host);

        Assert.Equal(43, issued.Credential.Length);
        Assert.All(
            issued.Credential,
            character => Assert.True(char.IsAsciiLetterOrDigit(character) || character is '-' or '_'));
        Assert.Equal(RoomId, issued.RoomId);
        Assert.Equal(ParticipantId, issued.ParticipantId);
        Assert.Equal(ParticipantRole.Host, issued.Role);
        Assert.Equal(IssuedAtUtc, issued.IssuedAtUtc);
        Assert.Equal(IssuedAtUtc.Add(Lifetime), issued.ExpiresAtUtc);

        var stored = Assert.Single(store.AddedSessions);
        var decodedCredential = Base64Url.DecodeFromChars(issued.Credential);
        Assert.Equal(SHA256.HashData(decodedCredential), stored.TokenHash);
        Assert.Equal(32, stored.TokenHash.Length);
        Assert.Equal(1, store.SaveChangesCallCount);
    }

    [Fact]
    public async Task ValidateAsync_returns_only_trusted_session_identity_for_the_expected_Room()
    {
        var store = new ParticipantSessionStoreSpy();
        var service = CreateService(store);
        var issued = await service.IssueAsync(RoomId, ParticipantId, ParticipantRole.Guest);

        var validated = await service.ValidateAsync(issued.Credential, RoomId);

        Assert.Equal(RoomId, validated.RoomId);
        Assert.Equal(ParticipantId, validated.ParticipantId);
        Assert.Equal(ParticipantRole.Guest, validated.Role);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not-a-token")]
    [InlineData("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")]
    public async Task ValidateAsync_rejects_malformed_credentials(string? credential)
    {
        var service = CreateService(new ParticipantSessionStoreSpy());

        await Assert.ThrowsAsync<ParticipantSessionInvalidException>(
            () => service.ValidateAsync(credential, RoomId));
    }

    [Fact]
    public async Task ValidateAsync_rejects_an_unknown_well_formed_credential()
    {
        var service = CreateService(new ParticipantSessionStoreSpy());
        var unknownCredential = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32));

        await Assert.ThrowsAsync<ParticipantSessionInvalidException>(
            () => service.ValidateAsync(unknownCredential, RoomId));
    }

    [Fact]
    public async Task ValidateAsync_rejects_the_session_at_its_expiration_boundary()
    {
        var store = new ParticipantSessionStoreSpy();
        var timeProvider = new FixedTimeProvider(IssuedAtUtc);
        var service = CreateService(store, timeProvider);
        var issued = await service.IssueAsync(RoomId, ParticipantId, ParticipantRole.Host);
        timeProvider.SetUtcNow(issued.ExpiresAtUtc);

        await Assert.ThrowsAsync<ParticipantSessionInvalidException>(
            () => service.ValidateAsync(issued.Credential, RoomId));
    }

    [Fact]
    public async Task ValidateAsync_rejects_a_credential_bound_to_another_Room()
    {
        var store = new ParticipantSessionStoreSpy();
        var service = CreateService(store);
        var issued = await service.IssueAsync(RoomId, ParticipantId, ParticipantRole.Host);

        var exception = await Assert.ThrowsAsync<ParticipantSessionInvalidException>(
            () => service.ValidateAsync(issued.Credential, OtherRoomId));

        Assert.DoesNotContain(issued.Credential, exception.Message, StringComparison.Ordinal);
    }

    private static ParticipantSessionService CreateService(
        ParticipantSessionStoreSpy store,
        TimeProvider? timeProvider = null)
    {
        return new ParticipantSessionService(
            store,
            new ParticipantSessionOptions(Lifetime),
            timeProvider ?? new FixedTimeProvider(IssuedAtUtc));
    }
}
