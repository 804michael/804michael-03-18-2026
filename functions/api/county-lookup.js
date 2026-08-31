// Cloudflare Pages Function
// Route: GET /api/county-lookup?address=101+N+Thompson+St%2C+Ashland%2C+VA
//
// The home affordability calculator's "Look Up County" button used to call
// the U.S. Census Bureau's public geocoder directly from the browser
// (geocoding.geo.census.gov). That works from some networks but not others —
// the Census API doesn't reliably send CORS headers, so browser fetches to
// it can fail silently with "Failed to fetch" depending on the visitor's
// browser/network. Routing it through this same-origin Function removes the
// CORS question entirely: the browser only ever talks to 804re.com, and this
// Worker does the outbound call to Census server-side (server-to-server
// requests aren't subject to CORS).
//
// No API key required — the Census geocoder is a free public service.
// Docs: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.pdf

const CENSUS_BASE = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';

function corsHeadersFor(request){
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = ['https://804re.com', 'https://www.804re.com'];
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function onRequestGet(context) {
  const { request } = context;
  const corsHeaders = corsHeadersFor(request);
  const jsonHeaders = { 'Content-Type': 'application/json', ...corsHeaders };

  const url = new URL(request.url);
  const address = (url.searchParams.get('address') || '').trim();

  if (address.length < 4) {
    return new Response(JSON.stringify({ error: 'address_too_short' }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const censusUrl =
    `${CENSUS_BASE}?address=${encodeURIComponent(address)}` +
    `&benchmark=Public_AR_Current&vintage=Current_Current` +
    `&layers=Counties,Incorporated%20Places&format=json`;

  try {
    const res = await fetch(censusUrl, {
      // A plain, generic UA — the Census geocoder has occasionally rejected
      // requests carrying Cloudflare Worker default headers.
      headers: { 'User-Agent': '804re.com-county-lookup/1.0' },
    });

    if (!res.ok) {
      throw new Error(`census_http_${res.status}`);
    }

    const data = await res.json();
    const match = data && data.result && Array.isArray(data.result.addressMatches)
      ? data.result.addressMatches[0]
      : null;

    if (!match) {
      return new Response(JSON.stringify({ matched: false }), { headers: jsonHeaders });
    }

    const geographies = match.geographies || {};
    const countyName = ((geographies['Counties'] || [])[0] || {}).NAME || '';
    const placeName = ((geographies['Incorporated Places'] || [])[0] || {}).NAME || '';
    const matchedAddress = match.matchedAddress || '';

    return new Response(JSON.stringify({
      matched: true,
      county: countyName,
      place: placeName,
      matchedAddress,
    }), { headers: jsonHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'lookup_unavailable' }), {
      status: 502,
      headers: jsonHeaders,
    });
  }
}

export async function onRequestOptions(context) {
  return new Response(null, { headers: corsHeadersFor(context.request) });
}
