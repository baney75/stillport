import {
  PortError,
  cancellationError,
  fail,
  timeoutSignal,
  waitFor,
} from "./core";
export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  fetcher: Fetcher = fetch,
): Promise<T> {
  const retryable = !init.method || init.method === "GET";
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        redirect: "error",
        signal: timeoutSignal(30_000, init.signal ?? undefined),
      });
    } catch {
      if (init.signal?.aborted) cancellationError();
      throw new PortError(
        "NETWORK_ERROR",
        "The service could not be reached.",
        "Check your connection and retry.",
        5,
      );
    }
    if (response.ok) {
      if (response.status === 204) return {} as T;
      try {
        return (await response.json()) as T;
      } catch {
        return fail("INVALID_RESPONSE", "The service returned invalid JSON.");
      }
    }
    if (
      retryable &&
      [429, 502, 503, 504].includes(response.status) &&
      attempt < 2
    ) {
      const retry = response.headers.get("retry-after");
      const delay =
        retry && /^\d+$/.test(retry)
          ? Math.min(Number(retry) * 1000, 30_000)
          : 250 * 2 ** attempt;
      await response.body?.cancel();
      await waitFor(delay, init.signal ?? undefined);
      continue;
    }
    // Provider bodies can echo credentials or signed URLs; never expose them.
    await response.body?.cancel();
    if (response.status === 401)
      fail(
        "AUTH_REQUIRED",
        "Google authorization expired or was revoked.",
        "Run stillport auth google again.",
        3,
      );
    if (response.status === 403)
      fail(
        "ACCESS_DENIED",
        "Google denied access.",
        "Enable the Photos Picker API, check the OAuth test-user list and requested scope, then sign in again.",
        3,
      );
    if ([404, 410].includes(response.status))
      fail(
        "NOT_FOUND",
        "The resource is missing or expired.",
        "Start a new Picker session and select the item again.",
        4,
      );
    if (response.status === 429)
      fail(
        "RATE_LIMITED",
        "The service is rate limiting requests.",
        "Retry later.",
        5,
      );
    fail(
      "HTTP_ERROR",
      `The service returned HTTP ${response.status}.`,
      "Check the command and provider setup. Retry only after resolving the error.",
      5,
    );
  }
}
