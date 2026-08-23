namespace Duovie.Api.Realtime;

public sealed record RoomWebRtcOffer(
    Guid ParticipantId,
    string Role,
    string Sdp);

public sealed record RoomWebRtcAnswer(
    Guid ParticipantId,
    string Role,
    string Sdp);

public sealed record RoomIceCandidate(
    Guid ParticipantId,
    string Role,
    string Candidate,
    string? SdpMid,
    int? SdpMLineIndex,
    string? UsernameFragment);

public static class RoomWebRtcSignalingRules
{
    public const int MaximumSdpLength = 16 * 1024;
    public const int MaximumCandidateLength = 4096;
    public const int MaximumSdpMidLength = 256;
    public const int MaximumUsernameFragmentLength = 256;
    public const string InvalidSignalError = "WebRTC signaling request is invalid.";
}

