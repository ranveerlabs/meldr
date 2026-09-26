# meldr

Check a live API against its OpenAPI contract. Meldr finds drift, patches the contract, then checks again.

```sh
npx @ranveergill/meldr demo
```

The demo runs in a throwaway directory. No setup needed.

![meldr verify --heal](https://raw.githubusercontent.com/ranveerlabs/meldr/main/assets/demo.svg)

## Use it

```sh
npm install -g @ranveergill/meldr
meldr init
meldr serve &
meldr verify
meldr heal --diff
```

`verify` sends one request per operation and compares the responses with the contract. `heal` patches safe differences; use `--all` to include changes that need review. Check the YAML diff before keeping it.

## Commands

`init` scaffold · `pull` import OpenAPI · `serve` mock · `gen` create a standalone server · `verify` check a live API · `heal` update a contract · `record` capture responses · `draft` write a contract from a description

Use `meldr heal --check` in CI to fail on drift without writing a patch.

## Notes

- `record` replaces common credential fields with `[scrubbed]`, but response bodies can still contain sensitive data. Review the file before sharing or committing it.
- `draft` uses your own API key. It is session-only and is not saved by Meldr.
- Stateful serving is opt-in; ordinary `serve` and `gen` are deterministic.

[CLI details](src/cli.js) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md) · [License](LICENSE)
