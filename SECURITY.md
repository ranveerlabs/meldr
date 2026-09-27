security

| Version | Supported |
| ------- | --------- |
| 0.1.x   | yes       |

Please dont open a public issue for a security bug. Use GitHub's private
reporting form:

<https://github.com/ranveerlabs/meldr/security/advisories/new>

Include a description, steps to reproduce it, affected versions and a proof of
concept if you have one. I aim to respond within 7 days.

Meldr is a developer tool. Only test APIs you have permission to use, and dont
put tokens in contract files.

keys
  Keys come from environment variables and stay in process memory only while the
  command using them runs. Meldr doesnt write or cache them, include them in logs,
  or leave them in printed errors. Requests that carry a key go only to the
  provider base URL you configured.
