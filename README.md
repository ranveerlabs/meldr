```
███    ███  ████████  ██       ████████   ███████
████  ████  ██        ██       ██     ██  ██    ██
██ ████ ██  ██████    ██       ██     ██  ███████
██  ██  ██  ██        ██       ██     ██  ██   ██ 
██      ██  ████████  ████████ ████████   ██    ██ 
```

meldr checks a live api against its openapi contract and patches the drift

an id went from int to string, a 201 turned into a 202, a new field never made
it into the yaml. meldr sends one real request per operation and compares the
response with the contract

![meldr verify --heal](https://raw.githubusercontent.com/ranveerlabs/meldr/main/assets/demo.svg)

thats a real run replayed at reading speed, the actual thing takes about a fifth
of a second. `node tools/demo.mjs` regenerates it

try it without installing anything

```
npx @ranveergill/meldr demo
```

the demo writes a contract and an api that no longer matches it into a
throwaway dir, then runs this

```
meldr verify --heal

verifying Meldr Petstore against http://localhost:4123

GET /v1/pets          FAIL 200  $[0].id: expected integer, got string; $[1].id: expected integer, got string
POST /v1/pets         FAIL 202  expected status 201, got 202; id: expected integer, got string
DELETE /v1/pets/{id}  PASS 204
GET /v1/pets/{id}     FAIL 200  id: expected integer, got string

1 passed · 3 failed

healing Meldr Petstore v1.0.0 against live http://localhost:4123

GET /v1/pets   FIX  $[0].id                  contract says integer, live sends string
GET /v1/pets   FIX  $[0].createdAt           live sends "createdAt" (string), contract does not declare it
POST /v1/pets  RISK responses.201 -> 202     contract's success is 201, live answers 202

✓ healed contracts\api.yaml, 2 fix(es) applied
  1 held back · rerun with --all to take the risky ones too

re-verifying Meldr Petstore against http://localhost:4123

GET /v1/pets          PASS 200
POST /v1/pets         FAIL 202  expected status 201, got 202
DELETE /v1/pets/{id}  PASS 204
GET /v1/pets/{id}     PASS 200

3 passed · 1 failed
  still red · `meldr verify --heal --all` takes the destructive fixes too
```

the status change stays red because taking it would remove the old response
from the contract. pass --all to include that patch

a fix to Pet.id follows the $ref into components/schemas/Pet, so it also fixes
the other operations using Pet. heal adds the time and patch count under
info.x-meldr. check the yaml diff after running it

```
fixed on sight
  type drift        integer -> string, the stale format and example go with it
  new fields        live sends createdAt, contract learns createdAt
  new statuses      recorded with the shape they actually returned

waits for --all
  moved success     201 -> 202, the old response node moves, it doesnt duplicate
  required gone     drops a name from required[] the api stopped sending
  dead upstream op  marked deprecated, never deleted
```

allOf/oneOf/anyOf get reported and never patched, i dont trust a merge of those
to come out the other side intact

commands

```
demo     red to green on a throwaway petstore, nothing to set up
init     scaffold a project with a starter contract
pull     ingest an OpenAPI 3.x contract (file or URL)
serve    run a wire-compatible replacement server
gen      generate a standalone, dependency-free editable server
verify   verify a running implementation against the contract
draft    BYOK: draft a contract from a description via your own AI key
record   capture the real API so you can serve it back offline
heal     patch the contract against the live api
```

quickstart

```
npm install -g @ranveergill/meldr
mkdir demo && cd demo
meldr init
meldr serve &
curl localhost:3000/ping
# {"status":"ok"}

meldr pull https://raw.githubusercontent.com/ranveerlabs/meldr/main/testdata/petstore.yaml
meldr serve &
curl localhost:3000/v1/pets/42
# {"id":42,"name":"Rex","tag":"friendly","status":"available"}

meldr verify
# 4 passed · 0 failed

meldr gen
node server.mjs
```

recording

record saves live responses for offline use

```
meldr record --base https://api.example.com --header "Authorization: Bearer $TOKEN"
meldr serve --from recording.json
```

it makes one real request per operation and saves the bodies to json, including
the ids, pagination and error shapes the api returned

access_token, refresh_token, client_secret and friends get replaced with
[scrubbed] before anything is written and it tells you how many it caught. read
the file before you commit it anyway, a response body holds more than you expect

anything not in the recording falls back to the contract, and X-Meldr-Status
still forces a declared response so your retry paths stay testable

one response per operation by default. list the ids you care about and it
captures each

```yaml
record:
  cases:
    getTrack:
      - {id: 11dFghVXANMlKmJXsNCbNl}
      - {id: 4cOdK2wGLETKBW3PvgPWqT}
```

replay picks the entry matching the id you asked for. ask for an id that was
never taped and you get the first one back so you can keep poking around,
--strict 404s instead and tells you which ids it does have

keeping writes

use --stateful when you need to read back things your client created

```
meldr serve --stateful --require-auth
```

you can POST an item and GET it back, change it with PUT or PATCH, then DELETE
it and get a 404 on the next read. the list includes those changes too. a
collection starts with data from the contract when you first use it

the store buckets on the last named segment of the path, so
/users/{id}/playlists and /playlists/{id} land in the same one. its a heuristic
and some paths will end up sharing a store when they shouldnt

in memory by default, --state-file state.json writes it out and picks it back up
next time so a session survives a restart

--require-auth 401s anything without a credential, honouring whatever
securitySchemes the contract declares. any value passes, its there so you can
build the token plumbing and the refresh-on-401 path

both are off unless you ask, so verify and gen stay deterministic

pointing it at a real api

generated ids can get a 404 from a real api, and missing credentials get a 401.
put working values in meldr.yaml. ${ENV} reads from your environment at run time
so you can commit the config without the token

```yaml
headers:
  Authorization: Bearer ${SPOTIFY_TOKEN}
params:
  default: {limit: 5}
  getTrack: {id: 11dFghVXANMlKmJXsNCbNl}
```

default applies to any param of that name, the operationId key wins over it. or
straight on the command line

```
meldr verify --header "Authorization: Bearer $TOKEN" --param id=11dFghVXANMlKmJXsNCbNl
```

your headers go on last so a contract cant overwrite your auth. a 429 gets
retried with the Retry-After it hands you rather than counted as drift, and
--concurrency sets how many operations go at once, 4 by default

see it before it writes

```
meldr heal --diff
```

heal edits the existing yaml Document, including its comments. it counts
`: '` and `: "` to choose whichever quote style you already use more

upstream drift

same thing against someone elses contract instead of a live server

```
meldr heal --upstream https://api.example.com/openapi.yaml
```

new operations get spliced in dereferenced so nothing points at components you
dont have. operations upstream dropped get `deprecated: true` and keep their
bodies

ci gate

use meldr heal --check in ci to exit 1 on drift without writing a patch.
you can run it through the action:

```yaml
- uses: ranveerlabs/meldr@main
  with:
    base: https://api.example.com
    headers: Authorization: Bearer ${{ secrets.API_TOKEN }}
    params: |
      id=11dFghVXANMlKmJXsNCbNl
```

or by hand if you want the pieces

```yaml
- run: meldr serve &
- run: meldr verify
- run: meldr heal --check --report drift.json
```

the action takes base, contract, upstream, report, working-directory, version
and fail-on-drift, and sets a `drifted` output so a later step can open the PR

drift.json has kind/op/at/detail/safety/patchable per finding plus a summary

the leftovers no rule can patch go to --ai, opt-in and BYOK, and it only ever
replaces `paths`. info, servers and components stay yours

config

meldr.yaml auto-generated on init

```yaml
name: demo
contract: contracts/api.yaml
port: 3000
cors: false
```

byok

keys come out of env only, OPENAI_API_KEY, ANTHROPIC_API_KEY, MELDR_*_KEY. any
provider works, --provider openrouter with --base-url and a MELDR_OPENROUTER_KEY
or OPENROUTER_API_KEY. openai and anthropic are the only two meldr knows the base
url for

a key lives in memory for the one command that used it. never written to disk,
never cached, never logged, and output gets scrubbed with [redacted] on the way
out. no telemetry, nothing phones home, it all runs locally

server internals

serve keeps draining an oversized request after it stops buffering. pausing
the stream can leave the client blocked on a write before it reads the 413.
the generated server does the same

license: apache-2.0
