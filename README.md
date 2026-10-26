# NewsSignal on Netlify

## What is in this folder
- `index.html`                    the dashboard (Dashboard tab + COT tab)
- `netlify/functions/api.mjs`     the free server part: headlines, red-folder calendar, DXY/FX prices, COT
- `netlify.toml`                  tells Netlify where the function lives (do not edit)

The function answers at `/api/news`, `/api/calendar`, `/api/yahoo` and `/api/cot` on your own site.
Gold and Nasdaq prices come straight from Hyperliquid in your browser (no server needed).
All times are shown in South African time (SAST, UTC+2).

---------------------------------------------------------------------
## METHOD A (recommended): GitHub + Netlify. Free, no command line.
Netlify's drag-and-drop upload does not reliably deploy functions, so use this.

1. Unzip this folder on your computer.
2. Make a free account at https://github.com, click "New repository", name it `newssignal`, click Create.
3. On the empty repository page click "uploading an existing file". Drag in everything inside the
   unzipped folder: `index.html`, `netlify.toml` and the whole `netlify` folder. Click "Commit changes".
   Check that the repository shows `netlify/functions/api.mjs`.
4. Make a free account at https://app.netlify.com (use "Sign up with GitHub").
5. Add new project -> Import an existing project -> GitHub -> pick `newssignal`.
6. Leave the build command EMPTY. Publish directory: `.` (a dot). Click Deploy.
7. After about a minute you get `https://something.netlify.app`. Open it.

To update later: edit/upload the file on GitHub and Netlify redeploys by itself.

## METHOD B: Netlify CLI (no GitHub)
1. Install Node.js (https://nodejs.org), then in a terminal: `npm install -g netlify-cli`
2. `netlify login`
3. `cd` into this folder and run: `netlify deploy --prod`
   (create a new site when asked; publish directory is `.`)

## METHOD C: drag and drop (quickest, but weakest)
Go to https://app.netlify.com/drop and drag the folder in. The page works, but Netlify may not deploy the
function. If it does not, the dashboard automatically switches to BACKUP routes:
- headlines: via a public RSS-to-JSON service (header shows "(backup)")
- calendar: ForexFactory feed directly, or through a public proxy
- COT: straight from the CFTC website in your browser
- DXY/FX: Binance (EUR, GBP, AUD) or Yahoo through a public proxy
Backup routes are free but less reliable and rate-limited. Use Method A for the real thing.

---------------------------------------------------------------------
## Check that everything works
Open these on your site (replace with your address). Each should show data, not an error:
- /api/calendar   a list of red-folder events (NFP, CPI, FOMC...)
- /api/news       headlines; "ok" should be most of 13
- /api/yahoo?sym=AUDUSD%3DX&range=1d&interval=1m   a price
- /api/cot        positions for 7 markets

On the dashboard:
- News Flow header shows `11/13 feeds · time` (or `(backup)` if the function is not running).
- High-Impact Calendar lists events in SAST with a currency filter.
- Prices have a green dot; FX/DXY show LIVE.
- COT tab shows 7 cards with an outlook.

## If something is not working
| Symptom | Cause | Fix |
|---|---|---|
| `/api/...` shows "Page not found" | function not deployed | use Method A or B; in Netlify check Functions tab shows `api` |
| News says OFFLINE | all feeds blocked | wait 1 minute; check /api/news; redeploy |
| COT says unavailable + a message | CFTC field names changed | send me the message |
| FX/DXY show SIM | Yahoo blocked Netlify's servers and backups failed | reload in a minute; send me a screenshot |
| Calendar says "unavailable" | ForexFactory feed down | retry; static short list is shown meanwhile |

## Free-plan limits (important)
Netlify's free plan has monthly usage limits for functions that change over time; check
https://www.netlify.com/pricing. One tab left open all day makes roughly 50,000 function calls a day
(FX prices every 15s, news every 20s). To stay inside free limits, use the dashboard during your trading
sessions and close the tab afterwards. Hidden tabs pause most refreshing automatically.
