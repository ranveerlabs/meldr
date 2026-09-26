# meldr

Meldr checks a live API against its OpenAPI file. If they disagree, it shows why and can update the file.

```sh
npx @ranveergill/meldr demo
```

This runs a demo in a temporary folder. No setup needed.

![meldr verify --heal](https://raw.githubusercontent.com/ranveerlabs/meldr/main/assets/demo.svg)

## Try it

```sh
npm install -g @ranveergill/meldr
meldr init
meldr serve &
meldr verify
meldr heal --diff
```

`verify` sends one request for each operation and compares the replies with the file. `heal` fixes simple mismatches. Add `--all` to apply the ones that need a closer look too. Check the YAML diff before keeping the changes.

## Commands

`init` start a project · `pull` get an OpenAPI file · `serve` run a mock API · `gen` make a standalone server · `verify` compare an API · `heal` update the file · `record` save replies · `draft` make a file from a description

Use `meldr heal --check` in CI to check for changes without editing the file.

## Notes

- `record` hides common credential fields, but replies can still contain private data. Check the file before sharing it.
- `draft` uses your API key for that run. Meldr doesn't save it.
- Saved server state is optional.

[CLI details](src/cli.js) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md) · [License](LICENSE)
