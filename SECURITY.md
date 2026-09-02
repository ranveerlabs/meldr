security

| Version | Supported |
| ------- | --------- |
| 0.1.x   | yes       |

dont open a public issue for a security bug. github private reporting is the
way in:

<https://github.com/ranveerlabs/meldr/security/advisories/new>

put a description in it, repro steps, which versions it hits, and a poc if you
have one. you get a first response inside 7 days

meldr is a dev tool. dont point it at APIs youre not allowed to test, and dont
commit tokens into contract files

keys
  they come out of env vars and sit in process memory for exactly as long as
  the one command that used them. never written to disk, never cached, never in
  a log, and scrubbed out of error messages before anything prints. the only
  outbound request carrying a key goes to the provider base url you set yourself
