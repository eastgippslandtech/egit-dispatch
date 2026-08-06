const MOBILE_AUTH_REDIRECT_URI = "egitcommand://auth/callback";

export function GET(request: Request) {
  const sourceUrl = new URL(request.url);
  const nativeUrl = new URL(MOBILE_AUTH_REDIRECT_URI);

  sourceUrl.searchParams.forEach((value, key) => {
    nativeUrl.searchParams.set(key, value);
  });

  return new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      Location: nativeUrl.toString(),
    },
    status: 302,
  });
}
