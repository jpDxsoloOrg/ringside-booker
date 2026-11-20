# Tester access codes (POL9-12)

Released test builds (the alpha and beta installers) ask for a **tester code** before the title
menu. The installer can stay public while the owner decides who actually plays. The repo stays
public too, and anyone may build the game from source without a code. The gate only covers the
released installer builds. It stops casual sharing of the installer, not a determined person, and
nothing is obfuscated.

## How it works

1. On first start, the game shows **Enter your tester code**. The player types a code such as
   `RB-7K3M-Q9TX`. Case, spaces and missing dashes don't matter. The code alphabet leaves out
   look-alikes (no 0, O, 1, I or L).
2. The game sends `POST /activate { code, installId, channel }` to the access service. `installId`
   is a random id the game makes once and keeps in `access.json` (below). `channel` is the build's
   channel. Nothing else is sent: no name, no e-mail and no hardware fingerprint.
3. The service checks the code (it exists, isn't revoked or expired, its channel opens this build,
   and it isn't on too many computers yet) and answers with a **licence token**:
   `base64url(payload JSON).base64url(Ed25519 signature)`. The payload holds the code id (a hash,
   never the code itself), the code's channel, the install id, the visible half of the code
   (`RB-7K3M`), when it was issued and when it expires.
4. The game checks the signature with the **public key built into it**
   (`Assets/Scripts/Release/Access/AccessConfig.cs`) and stores the token in
   `%USERPROFILE%\AppData\LocalLow\jpDxsolo\Ringside Booker\access.json`. From then on every
   start checks the token **offline**.
5. **Refresh:** once a week, when online, the game calls `POST /refresh { token }` in the
   background and gets a new token. After a failed try it waits a day before trying again.
6. **Offline grace:** a token expires 30 days after the last successful check (or on the code's own
   expiry date, if that comes first). After 30 days offline the gate asks the player to go online
   once ("Try again"), or to enter the code.
7. **Revoked codes:** the next refresh answers `revoked`. The game removes the token and shows the
   gate. A revoked code therefore stops within a week for a player who is online, and within 30
   days for one who stays offline.

**Channels:** an **alpha** code opens alpha and beta builds. A **beta** code opens beta builds
only. Release builds (`channel: release`) have no gate.

**Who never sees the gate:** the Unity editor, development builds, local builds (no
`version.json`, channel `local`), the release channel, builds whose `AccessConfig.PublicKey` is
empty, batch mode, and dev runs (any `-rb…` switch, so the smoke tours keep working).
`-rbAccessTour` turns the gate back on for the access tour.

**Settings › About** shows "Tester access: active (RB-7K3M-••••)", how long the game works
offline, and **Remove this code**. Removing forgets the token but keeps the install id, so entering
the same code again on the same computer doesn't use up another slot.

**What the player sees when something goes wrong:**

| Service answer       | The game says                                                          |
| -------------------- | ---------------------------------------------------------------------- |
| `invalid_code`       | That code isn't valid. Check it against the message you were sent.     |
| `too_many_computers` | This code has been used on too many computers. Ask for it to be reset. |
| `revoked`            | This code has been turned off. Ask for a new one.                      |
| `expired`            | This code has expired. Ask for a new one.                              |
| `wrong_channel`      | This code is for a different test build.                               |
| `not_activated`      | This computer was taken off your code. Enter the code again.           |
| `rate_limited`       | Too many tries with this code in the last hour. Wait a while.          |
| no answer            | Couldn't reach the server. Check your connection and try again.        |

## The service (`services/access/`)

| Piece               | What it is                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack               | CloudFormation `ringside-booker-access` (Serverless Framework v3, service `ringside-booker-access`, stage `prod`, us-east-1, account profile `league-szn`) |
| API                 | HTTP API: `POST /activate`, `POST /refresh`. Throttled to 5 requests a second (burst 10) for the whole API.                                                |
| Functions           | `ringside-booker-access-prod-activate`, `-refresh` (on the API) and `-keygen` (not on the API). Node 20, arm64, 256 MB.                                    |
| Table               | DynamoDB `ringside-booker-access-codes`, on demand, key `codeId` (a SHA-256 of the code).                                                                  |
| Signing key         | SSM SecureString `/ringside-booker-access/prod/signing-key` (Ed25519, PKCS#8). It was made inside AWS by the keygen function and never leaves it.          |
| Public key          | SSM String `/ringside-booker-access/prod/public-key`, copied into `AccessConfig.PublicKey`.                                                                |
| Per-code rate limit | 20 activate or refresh calls an hour per code, counted in the code's row.                                                                                  |

Code: `src/codes.ts` (code format and channels), `src/token.ts` (token format), `src/store.ts`
(table access), `src/handlers.ts` (the two endpoints), `src/lambda.ts` (AWS wiring and keygen).
Tests: `npm test` in `services/access` (DynamoDB is mocked). The service installs its own packages
and is not an npm workspace, so the repo's lint skips `services/**`. Run `npm run lint` and
`npm run typecheck` inside `services/access`.

## Make a code for a friend

From `services/access` (run `npm ci` once):

```bash
npm run codes -- create --label "Sam"
```

It prints the code (for example `RB-7K3M-Q9TX`); send that to the tester. Options:

- `--channel alpha|beta`: alpha (the default) opens alpha and beta builds; beta opens beta builds only.
- `--max 2`: how many computers can use the code (the default is 2).
- `--expires 2027-06-30`: the code stops working at the end of that day (UTC). The default is no expiry.

The tool works directly on the table through the `league-szn` AWS profile (set `AWS_PROFILE` to
use another one). There is no admin web page.

## See, revoke and reset codes

```bash
npm run codes -- list                   # every code: status, channel, computers used, label
npm run codes -- revoke RB-7K3M-Q9TX    # turn it off for good
npm run codes -- reset RB-7K3M-Q9TX     # forget its computers (a tester got a new PC)
npm run codes -- delete RB-7K3M-Q9TX    # remove the row (throwaway test codes)
```

## Deploy, or set up from scratch

```bash
cd services/access
npm ci
npm run deploy        # build, then serverless deploy (stack ringside-booker-access)
npm run keygen        # once: makes the key pair in SSM, prints only the public key
```

Put the printed public key into `AccessConfig.PublicKey` and the stack's `AccessApiUrl` output into
`AccessConfig.ApiUrl`. Running keygen again prints the same public key and changes nothing.
**Never** delete or overwrite the signing key while testers have tokens: a new key turns every
token into "couldn't be read" and every tester has to enter their code again.

## Cost

For a handful of testers this is effectively free:

- Lambda, HTTP API and DynamoDB on-demand all bill per request. A tester makes about one call a
  week, so even 100 testers stay far inside the always-free Lambda allowance and cost cents a
  month for the API and the table.
- The SSM parameters are standard tier (free). Reading the SecureString uses the AWS-managed
  `aws/ssm` key (no monthly key charge).
- CloudWatch Logs keep 14 days. The Serverless deployment bucket holds the deployment zips (a few
  hundred KB each).
- The throttle (5 a second for the whole API) and the per-code limit keep a misbehaving client
  from running up a bill.

## Tear it down

```bash
cd services/access
npm run remove   # deletes the stack: API, functions, table (all codes!), log groups, deployment bucket
aws ssm delete-parameter --name /ringside-booker-access/prod/signing-key --profile league-szn --region us-east-1
aws ssm delete-parameter --name /ringside-booker-access/prod/public-key --profile league-szn --region us-east-1
```

The two SSM parameters are made by keygen, not by the stack, so they are deleted by hand. Once the
stack is gone, released builds with the gate can't activate new computers, and existing tokens run
out after their 30-day grace. To turn the gate off in new builds instead, blank
`AccessConfig.PublicKey`.

## Dev and tests

- EditMode tests: `game/tools/unity-test-editmode.sh RingsideBooker.Tests.Release.AccessTests`
  (Ed25519 against the RFC 8032 vectors, a token made by the service's Node code, valid, expired,
  wrong signature, wrong channel, another computer, the grace and refresh rules, the reply parser and
  the stored file). Fixed test keys, no network.
- Service tests: `cd services/access && npm test`.
- Tour: `RingsideBooker.exe -screen-fullscreen 0 -rbAccessTour "<win dir>" [-rbAccessCode RB-XXXX-XXXX] [-rbAccessRemove]`
  (`Screens/Dev/AccessTour.cs`, a packaged alpha or beta build only). With a code, it types it into
  the real gate, presses Start playing (a real call to the service), opens Settings › About and
  starts the demo game. Without one, it checks that the stored licence is remembered (no gate).
  `-rbAccessRemove` presses Remove this code and checks that the gate comes back. It takes PNGs at
  each step and exits 0 when every check passed.
