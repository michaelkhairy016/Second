// Vercel Edge Function: reverse-proxy to the Netlify SSR origin.
// Vercel's network can reach the Netlify edge even where end-user ISPs cannot.
// Browser -> car-flow-command.vercel.app (reachable) -> this fn -> admirable-moxie-b64a25.netlify.app
export const config = {
  runtime: "edge",
};

const UPSTREAM = "https://admirable-moxie-b64a25.netlify.app";

// Headers that must not be forwarded verbatim.
const STRIP_REQ = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade",
  "content-length",
]);
const STRIP_RES = new Set([
  "content-encoding", "content-length", "transfer-encoding",
  "connection", "keep-alive",
]);

export default async function handler(req: Request): Promise<Response> {
  const incoming = new URL(req.url);
  // vercel.json rewrites all paths to /api/<original>; restore the original path.
  let path = incoming.pathname.replace(/^\/api/, "");
  if (path === "") path = "/";
  const target = UPSTREAM + path + incoming.search;

  const reqHeaders = new Headers();
  for (const [k, v] of req.headers.entries()) {
    if (!STRIP_REQ.has(k.toLowerCase())) reqHeaders.set(k, v);
  }
  reqHeaders.set("x-forwarded-host", incoming.host);
  reqHeaders.set("x-forwarded-proto", incoming.protocol.replace(":", ""));

  const init: RequestInit = {
    method: req.method,
    headers: reqHeaders,
    redirect: "manual",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.blob();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (e) {
    return new Response("Upstream fetch failed: " + String(e), { status: 502 });
  }

  const resHeaders = new Headers();
  for (const [k, v] of upstream.headers.entries()) {
    if (!STRIP_RES.has(k.toLowerCase())) resHeaders.set(k, v);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  });
}
