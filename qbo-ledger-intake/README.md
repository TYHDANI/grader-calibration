# qbo-ledger-intake

Your boss photographs a page of the handwritten payments ledger. Claude reads every row
(date, customer, trip, amount, Zelle / cash / check number / card). The tool matches each
row to a QuickBooks Online customer and their open invoices, flags anything doubtful, and
then, after a human says yes, creates the Payment records in QuickBooks through the API.

Nothing is written to QuickBooks until a row is approved. Handwriting, ditto marks and
"same last name" customers are exactly where a fully automatic system would post money to
the wrong account, so the review step stays.

## The daily flow

```
photo(s) of the ledger page
        |
        v
node src/cli.ts review ledger.jpg          # Claude + QuickBooks lookups, writes out/proposal-*.json
        |
        v
look at the table; READY rows are pre-approved, REVIEW rows explain what is doubtful
edit the JSON if needed (customer id, amount, invoice), set "approved": true
        |
        v
node src/cli.ts post out/proposal-*.json   # creates one Payment per approved row
```

Example output for the photo in this conversation (the 9/28 Francine Mitchell row):

```
ROW  STATUS  DATE       LEDGER NAME           QBO CUSTOMER            AMOUNT    METHOD      APPLY TO
23   REVIEW  2026-09-28 Francine Mitchell     Mitchell, Francine (1)  $405.00   Zelle       #6912 $405.00
       ! a payment for the same amount already exists on 2026-09-28 (possible duplicate)
```

That row is flagged because QuickBooks already shows a 9/28/26 payment for her. Rows that
were never entered come back READY.

## One-time setup

1. **Intuit app.** At developer.intuit.com create an app (QuickBooks Online and Payments,
   Accounting scope). Under *Keys & credentials* copy the Client ID and Client Secret. Add
   `http://localhost:8765/callback` as a Redirect URI. Do this for the sandbox keys first,
   then for production keys when you connect the real STC Tours company.
2. **Env.** Copy `.env.example` to `.env`, fill it in, and load it (`set -a; . ./.env; set +a`
   or any env loader). You need an `ANTHROPIC_API_KEY` from console.anthropic.com.
3. `npm install`
4. `npm run auth`, open the printed URL, sign in as the QuickBooks admin, pick the company.
   Tokens land in `.qbo-tokens.json` (mode 600). Keep that file private. They refresh
   automatically; if the tool is unused for 100 days you re-run `npm run auth`.
5. In QuickBooks make sure a Payment Method exists for each thing the ledger uses:
   Zelle, Cash, Check, PayPal, a card method. The tool matches by name.

Start with `QBO_ENV=sandbox` and the Intuit sandbox company. Switch to `production` only
after the posted payments look right.

## What each row goes through

- **Extraction.** One Claude call per photo, structured output validated against
  `src/schema.ts`. The prompt in `src/extract.ts` teaches the ledger conventions: `m/d`
  dates with the year assumed, dates carried down, ditto marks meaning "same method as the
  row above", `CK 2583` = check 2583, `CC 4976` = card ending 4976, highlighter colour
  ignored. The current QuickBooks customer list is passed in as a spelling hint.
- **Customer match.** `src/match.ts` scores "First Last" against QuickBooks "Last, First".
  Exact = ready. Same last name with a nickname, or a misspelling = review, with the
  alternatives listed. Two customers who both match strongly = review.
- **Invoices.** Open invoices for that customer, preferring one whose memo or lines mention
  the trip, then oldest first. The payment is applied in that order; anything left over
  stays as customer credit (no `Line` on that part, same as entering an unapplied payment
  in the QuickBooks UI).
- **Duplicates.** Any existing payment for that customer with the same amount within 7 days
  of the ledger date flags the row.
- **Posting.** `POST /v3/company/{realm}/payment` with `CustomerRef`, `TotalAmt`,
  `TxnDate`, `PaymentMethodRef`, `PaymentRefNum` (check or card digits), `PrivateNote`
  (trip and ledger row), optional `DepositToAccountRef`, and `Line` entries linking the
  invoices. The proposal file is saved after every row, so a crash or re-run never posts
  the same row twice.

## Getting the photos to it

`review` takes file paths, so it works with anything that lands a file on the machine that
runs it. Three ways to wire the hand-off, from least to most work:

1. **Shared folder.** Boss drops the photo in a Google Drive or Dropbox folder from the phone;
   a cron job runs `review` on new files and emails the table back.
2. **Email.** Boss emails the photo to a mailbox the office polls; same script.
3. **Chat.** A Slack or WhatsApp bot that accepts an image, runs `review`, posts the table,
   and treats a thumbs-up on a row as approval, then runs `post`.

Option 1 is a few lines of shell. Option 3 is the nicest for a phone but needs a bot host.

## Commands

```
node src/cli.ts review <photo...> [--year 2026] [--out file]
node src/cli.ts post <proposal.json> [--dry-run]
node src/cli.ts extract <photo...>        # Claude only, no QuickBooks needed
node src/cli.ts propose <extract.json>    # QuickBooks only, from a saved extract
npm test                                   # name/method matching tests, no network
npm run typecheck
```

## Costs and limits

- Claude: one call per page at `claude-opus-5-5` with a photo of this size is roughly
  2,000 to 3,000 input tokens and 2,000 to 4,000 output tokens, well under 10 cents a page.
  The rules and customer list are cached across pages.
- QuickBooks: a handful of read queries per row (invoices, recent payments). A 25-row page
  is under 60 requests, far below Intuit's limit of 500 per minute per company.
- Rows with two names, two trips, or a crossed-out amount come back as REVIEW with a note.
  The tool never merges or invents rows; if Claude reports fewer rows than the page has,
  retake the photo straight-on with the whole page in frame.
