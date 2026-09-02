```
███    ███  ████████  ██       ████████   ███████
████  ████  ██        ██       ██     ██  ██    ██
██ ████ ██  ██████    ██       ██     ██  ███████
██  ██  ██  ██        ██       ██     ██  ██   ██ 
██      ██  ████████  ████████ ████████   ██    ██ 
```

meldr, wire-compatible API replacements without the rebuild

your openapi file is lying to you. the api shipped a field, an id went from int
to string, a 201 quietly became a 202, and nothing told the yaml sitting in your
repo. meldr sends one real request per operation, compares what came back
against what the contract claims, and writes the difference back

![meldr verify --heal](https://raw.githubusercontent.com/ranveerlabs/meldr/main/assets/demo.svg)

thats a real run replayed at reading speed, the actual thing takes about a fifth
of a second. `node tools/demo.mjs` regenerates it

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

FIX goes in on sight. RISK waits for --all bcuz it deletes something, thats why
that run ends one short. the patches go in through the $ref so one fix to Pet.id
lands in components/schemas/Pet and every operation using it moves at once, read
the git diff after, its a normal yaml diff

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

allOf/oneOf/anyOf get reported and never auto-patched, too easy to wreck

commands

```
init     scaffold a project with a starter contract
pull     ingest an OpenAPI 3.x contract (file or URL)
serve    run a wire-compatible replacement server
gen      generate a standalone, dependency-free editable server
verify   verify a running implementation against the contract
draft    BYOK: draft a contract from a description via your own AI key
heal     self-maintain: pull the contract back onto the live api
```

quickstart

```
npm install -g github:ranveerlabs/meldr
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

pointing it at a real api

synthetic ids 404 and unauthenticated calls 401, so both are worth pinning.
meldr.yaml holds them and ${ENV} is read at run time, the file stays commitable

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

comments and quote style survive a heal, the diff is the three real changes and
not a reflow of the whole file

upstream drift

same thing against someone elses contract instead of a live server

```
meldr heal --upstream https://api.example.com/openapi.yaml
```

new operations get spliced in dereferenced so nothing points at components you
dont have. operations upstream dropped get `deprecated: true` and keep their
bodies

ci gate

meldr heal --check writes nothing and exits 1 on drift. theres an action so you
dont have to wire it yourself

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

drift.json is stable, kind/op/at/detail/safety/patchable per finding plus a
summary. wire it to whatever opens the PR

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

byok & zero leaks

- keys from env only (OPENAI_API_KEY, ANTHROPIC_API_KEY, MELDR_*_KEY)
- any provider works, --provider openrouter with --base-url and a
  MELDR_OPENROUTER_KEY or OPENROUTER_API_KEY. openai and anthropic are the only
  two meldr knows the base url for
- in-memory only for the single cmd session, never written to disk, never cached, never logged
- output auto-scrubs key leaks with [redacted]
- no telemetry, no tracking, pure local execution

license: apache-2.0
