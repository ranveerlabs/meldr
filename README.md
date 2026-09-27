# meldr

`meldr verify` sends a request for each operation in an OpenAPI file and compares the response with the contract. `meldr heal` writes a patch for safe differences. `--all` pulls in the ones that need review too, so check the YAML before keeping it.

```sh
npx @ranveergill/meldr demo
```

The demo runs in a throwaway directory. You can try it without setting up an API.

![meldr verify --heal](https://raw.githubusercontent.com/ranveerlabs/meldr/main/assets/demo.svg)

## run it

```sh
npm install -g @ranveergill/meldr
meldr init
meldr serve &
meldr verify
meldr heal --diff
```

## commands

`init` scaffolds a project and `pull` imports OpenAPI. `serve` runs a mock, `gen` makes a standalone server, `record` saves responses, and `draft` writes a spec from a description.

I use `meldr heal --check` in CI. It fails on drift without writing a patch.

## Notes

- `record` replaces common credential fields with `[scrubbed]`, but response bodies can still have private data. Read the file before sharing or committing it.
- `draft` uses your API key for that run. Meldr doesn't save it.
- Stateful serving is opt-in. Plain `serve` and `gen` are deterministic.

[CLI details](src/cli.js) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md) · [License](LICENSE)
