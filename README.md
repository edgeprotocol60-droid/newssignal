# NewsSignal on Netlify

The complete dashboard is in `index.html`. The complete Netlify v2 handler is in `netlify/functions/api.mjs`. Deploy these together with `netlify.toml`, `package.json`, and `package-lock.json` through the connected GitHub repository. Keep the publish directory `.` and leave the build command empty. Netlify installs the dependency automatically. No API key is required.

## Diagnosis

The supplied function was at `api.mjs` in the repository root, while the deployment configuration uses `netlify/functions`. Netlify therefore could not discover that function. This also broke the Yahoo proxy used by DXY and USDJPY; EUR, GBP, and AUD had separate Binance fallbacks. The browser backup depended entirely on rss2json, creating another single point of failure.

Outbound probes found 12 of the original 13 feeds returning HTTP 200 with RSS entries; FXStreet returned HTTP 403 and was replaced with ECB (HTTP 200). GDELT timed out during the probe and remains only an opportunistic browser fallback. The original public `/api/news` returned HTTP 401 login-redirect HTML from this environment. Consequently, production function logs and the precise live failure could not be inspected. The file-placement defect is verified in the supplied repository; a production timeout or IP block was not established.

## Behavior

News sources run in parallel with five-second timeouts. News can return partial results after a 1.2-second collection window following the first useful result; unfinished requests are cancelled and reported. `/api/health` runs the full checks and reports each source's HTTP status (null if no HTTP response), timing, parse failure, and recent item count. Successful feeds can legitimately have no releases within 48 hours. News and health responses have a 25-second Netlify CDN cache policy; quotes use 30 seconds. Actual CDN cache hits require deployment and cannot be proven with local emulation.

News is deduplicated, sorted, and limited to 48 hours. The browser tries the API, direct Fed/GDELT requests, then a public proxy. Last good headlines survive reload in localStorage. An outage shows cached status and the last successful update in SAST; a fresh browser with no cached news and no working source shows a populated retry message. No implementation can supply genuine current headlines when every source and cache is unavailable. Headlines older than 48 hours are removed rather than presented as current.

News bias is a transparent heuristic, not a prediction: per-market phrases, central-bank direction, source quality, event importance, and eight-hour recency decay determine the score. The last eight hours contribute. Relevant but nondirectional headlines count and show a neutral bullet; directional contributors show arrows. Optional Alpha Vantage ticker sentiment overrides matching market scores. Signal Detail and Market Interpretation use 60% technical and 40% news; the detail explains disagreements and keeps technical entry/stop/target levels. The Live Signal Board retains its technical score and adds a separate N news badge.

Yahoo supplies DXY and yen chart data; the yen request uses Yahoo's `JPY=X` alias. If DXY fails, six Yahoo FX legs calculate the ICE basket. Calculated candles are aligned close-only points, not genuine intrabar OHLC. The next fallback is ExchangeRate-API's daily reference rates, clearly labelled with their original timestamp and no invented candles or intraday signal. Twelve Data is an optional FX fallback. Yahoo prices are labelled delayed/indicative, rather than guaranteed tick-by-tick exchange data. A total price-provider outage shows unavailable or the last actual quote with its age.

Gold and Nasdaq keep Hyperliquid, FX retains browser Yahoo/Binance fallbacks, and the existing calendar, COT tab, and currency-strength panel remain. News and price polling pause in hidden tabs; visible news polls every 20 seconds and FX quotes approximately every minute. CDN caching reduces upstream work, but provider and Netlify free allowances still apply.

## Optional free keys

Neither key is required. Do not add keys to `index.html` or commit them.

- `TWELVE_DATA_API_KEY`: Open https://twelvedata.com/pricing, choose the free Basic plan, create/sign in to an account, and copy the API key from the account dashboard. Add it in Netlify as described below. It is used only when Yahoo FX fails. The provider's free daily/minute credits and symbol entitlements apply; verify the current Basic allowance in the provider dashboard. No paid upgrade is needed by this implementation.
- `ALPHA_VANTAGE_API_KEY`: Open https://www.alphavantage.co/support/#api-key, complete the free API-key form, and copy the issued key. The function requests `NEWS_SENTIMENT` only on the server. Successful responses and provider-limit responses are cached in Netlify Blobs for two hours to reduce free-key usage. Concurrent cold cache misses and other apps sharing the key can still consume extra credits. Provider entitlements may change; if NEWS_SENTIMENT is unavailable for your free key, leave this variable unset and the lexicon works normally. If durable caching is unavailable, this optional source is skipped to protect the quota.

For either key: Netlify dashboard → select this project → Project configuration → Environment variables → Add a variable → enter the exact name above and your key as the value → select the Functions/runtime scope if scope controls appear (otherwise all scopes) → enable the Production and Deploy Preview contexts you need → Save. Trigger a new deploy from Deploys → Trigger deploy → Deploy site so runtime configuration updates. Do not paste key values into URLs, screenshots, frontend code, or GitHub.

## Test checklist

After the GitHub deploy finishes, check the Functions page lists `api`, then open:

1. `/api/health`: JSON with `sources`, `ok`, `total`, HTTP status, milliseconds, errors, and counts. Failures remain visible instead of turning the endpoint into a 502.
2. `/api/news`: newest-first `items`, unique headlines within 48 hours, and source diagnostics. Successful-source counts depend on current upstream availability.
3. `/api/yahoo?sym=DX-Y.NYB&range=1d&interval=1m`: positive `price`, original `ts`, a source label, and real candles or explicitly marked daily-reference fallback.
4. `/api/yahoo?sym=USDJPY%3DX&range=1d&interval=1m`: the equivalent yen data; no synthetic quote.
5. `/api/calendar` and `/api/cot`: verify existing calendar and positioning data remain usable. These external providers can independently throttle requests.
6. Dashboard: News Flow has headlines, newest time in SAST, and an expandable `feeds: … ok` summary. Selecting different symbols changes the news score, contributors, N badges, and signal reasoning. The detail starts with NEWS and TECHNICAL, then explains the 60/40 combined score.
7. After one successful news load, block `/api/news` and external news requests in browser DevTools, then reload. Cached headlines remain and the header turns amber with last updated SAST. Unblock requests and verify recovery. On a brand-new browser with all sources blocked, expect the explicit retry message.
8. Hide the tab and verify recurring news/price requests pause; return to it and verify news refreshes. Check delayed prices display their source and age beneath the quote.

## Validation performed

`node --test tests/api.test.mjs` exercises feed/parser failures, HTTP diagnostics, stale-item removal, deduplication, early partial results, total news failure, daily DXY calculation, yen fallback, and symbol validation. Syntax checks passed for the function and inline dashboard JavaScript. A DOM smoke check rendered 50 headlines, the feed summary, chips, and signal reasoning, and checked central-bank direction, disagreement, and malicious headline/link escaping.

Direct handler network checks returned 13/13 feeds and 98 recent headlines, DXY 101.796 (about ten minutes delayed), and USDJPY 157.127 at the time checked. These are test observations, not hardcoded prices. Local Netlify routing results are recorded in the delivery summary.

No production deployment, full graphical-browser session, browser CORS reliability, optional-key entitlement, or deployed CDN cache hit was verified. No build command was run; deployment validation is handled by the platform.

Local Netlify routing checks returned HTTP 200 for `/api/health` (13/13, 98 headlines), `/api/news` (13/13, 98 headlines), DXY, USDJPY, and `/api/calendar` (25 events). `/api/cot` timed out against CFTC during the probe; live COT could not be confirmed. COT requests have a separate 15-second upstream allowance. Six regression tests passed, including the live six-pair calculated-DXY path.
