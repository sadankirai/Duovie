namespace Duovie.Application.ParticipantSessions;

public sealed class ParticipantSessionAuthorizationException()
    : Exception("The participant session is not authorized for this Room.");
