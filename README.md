# Rasoi Saathi tool server

One Vercel deployment that serves all 31 tools in `lib/tools.json` to the Rasoi Saathi agent:

| Group | Tools | What it is |
| --- | --- | --- |
| `delhivery_mock` | 6 `dlv_*` | Mock. Delhivery paths and field names, synthetic data |
| `rasoi_capabilities` | 3 `rasoi_*` | Grocery quote (synthetic catalogue), policy engine (real logic), nutrition (approximate table) |
| `pine_labs` | 10 `pine_*` | Mock. No real money moves. Mandate paths are placeholders |
| `telegram` | 5 `tg_*` | Real Telegram Bot API |
| `gnani` | 2 `gnani_*` | Real Gnani Vachana STT / TTS |
| `google_sheets` | 3 `sheets_*` | Real Google Sheets API (service account) |
| `gmail` | 2 `gmail_*` | Real Gmail API, read-only |

## Endpoints

- MCP (Streamable HTTP, JSON-RPC over POST): `https://<project>.vercel.app/mcp`
- One group only: `/mcp/delhivery`, `/mcp/rasoi`, `/mcp/pine`, `/mcp/telegram`, `/mcp/sheets`, `/mcp/gmail`, `/mcp/gnani`, `/mcp/mocks`, `/mcp/real`
- Status (no secrets): `GET /`
- REST mirrors of the mocks at the paths in `tools.json`, e.g. `GET /c/api/pin-codes/json/?filter_codes=700064`, `POST /rasoi/v1/policy/evaluate`, `POST /api/pay/v1/orders`

## Deploy

1. Put these files at the root of the GitHub repo that the Vercel project builds from (`api/`, `lib/`, `test/`, `package.json`, `vercel.json`).
2. In Vercel, set the environment variables listed in `.env.example`. `RASOI_API_KEY` first.
3. Redeploy, then open `https://<project>.vercel.app/` and check each connector says `configured`.

No build step and no dependencies. Local check: `node test/smoke.js`.

## Register in AgenticOrg

Connectors -> Register Connector -> Custom / Generic, MCP ticked.

- MCP Server URL: `https://<project>.vercel.app/mcp`
- Auth Type: Api Key, value = `RASOI_API_KEY`
- If the platform does not send the key in a header this server recognises (`Authorization`, `x-api-key`, `api-key`), use `https://<project>.vercel.app/mcp?key=<RASOI_API_KEY>` with Auth Type None.

## Demo triggers (mocks)

| To show | Do this |
| --- | --- |
| Pincode not serviceable | Use a pincode ending in `99` |
| No rider | `pickup_time` before 07:00 or from 21:00 |
| Late delivery / undelivered | Order ref ending `-LATE` / `-UNDEL` |
| Unknown waybill | Any waybill this server did not issue |
| Payment pending, then processed | Order ref ending `-PEND` (settles after about 20 s) |
| Payment failed (insufficient balance) | Order ref ending `-FAIL` |
| Duplicate order | Call `pine_create_order` twice with the same reference |
| Out of stock | Curd 500 g at `FM-SALTLAKE`; paneer 200 g at `BB-NEWTOWN`; bhindi at `KIRANA-CK` |
| Store quote failed | Any store id containing `DOWN` |
| Unknown dish | Any dish not in the table returns 404 `dish_not_found` |

Seeded mandate: `MND-DEMO-001` (ACTIVE, 15000 a month, 2500 an order, in rupees). Mandates made with `pine_create_mandate_link` become ACTIVE 30 s after creation. Stores: `FM-SALTLAKE` (700064), `BB-NEWTOWN` (700156), `KIRANA-CK` (700091). A delivery runs Manifested -> In Transit -> Dispatched -> Delivered over 40 minutes.

## Policy engine: mandate row fields it reads

`status`, `expires_at`, `per_order_cap`, `monthly_cap`, `spent_this_month`, `approved_merchants`, `approved_substitutions` (`from -> to`), optional `auto_pay`. Amounts are rupees unless the field name ends in `_paise`. A missing field means ESCALATE, never AUTO.

## Limits to know

- Nutrition numbers are approximations for a demo, not clinical data.
- Without a KV store, mock orders, shipments and mandate changes are kept in memory only.
- This server does not receive Telegram updates. The agent platform needs its own trigger (webhook or polling) to start a run when a message arrives.
