using Duovie.Application.Rooms;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace Duovie.Api.Errors;

public sealed class RoomExceptionHandler(IProblemDetailsService problemDetailsService)
    : IExceptionHandler
{
    private readonly IProblemDetailsService _problemDetailsService = problemDetailsService
        ?? throw new ArgumentNullException(nameof(problemDetailsService));

    public ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        var error = exception switch
        {
            RoomNotFoundException => new RoomError(
                StatusCodes.Status404NotFound,
                "Room not found."),
            RoomJoinRejectedException => new RoomError(
                StatusCodes.Status409Conflict,
                "Room cannot be joined."),
            RoomConcurrencyException => new RoomError(
                StatusCodes.Status409Conflict,
                "Room state conflict."),
            _ => null,
        };

        if (error is null)
        {
            return ValueTask.FromResult(false);
        }

        httpContext.Response.StatusCode = error.StatusCode;

        return _problemDetailsService.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            ProblemDetails = new ProblemDetails
            {
                Status = error.StatusCode,
                Title = error.Title,
            },
        });
    }

    private sealed record RoomError(int StatusCode, string Title);
}
