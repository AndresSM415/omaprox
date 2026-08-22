# Omaprox — development notes

## Next release backlog

From the full security re-scan of 2026-08-17 (nothing here is exploitable
as-is; optional hardening):

- **`Text` elements default to `AutoText`.** API-derived strings that look
  like HTML (a guest named `<b>pwned</b>`, an error message) render styled
  in the panel. Cosmetic spoofing only — no code execution. Set
  `textFormat: Text.PlainText` on the row/error/name texts.
- **Warn on world-readable token file.** The README says `chmod 600` but
  the plugin never checks. Stat `credentialsPath` and surface a warning in
  the setup/error area when the file is group/other-readable.
- **`ssh --` separator in `bin/omaprox-ssh`.** Belt-and-suspenders only —
  OpenSSH 10.5 rejects option-parsing in the `user@host` form (tested).
  Add `--` before `$TARGET` in `connect()` and `ssh-copy-id` anyway.
- **`curlConfig` url quoting.** The host is interpolated into a quoted
  config string without escaping. Only reachable through the user's own
  config today; escape `"`/`\` if that surface ever widens.

Things that cost time here, recorded so they do not cost it twice:

- **Editing a `.js` file does not hot-reload.** Saving under
  `~/.config/omarchy/plugins/` logs `Local plugin changed, reloading` and
  reloads `.qml`, but an imported `.js` module keeps its old contents. Run
  `omarchy restart shell` after touching `Api.js` or `Model.js`. A changed QML
  *binding* can also need a restart before it re-evaluates.
- **QML load failures are silent on screen.** The widget just does not appear.
  `quickshell list --all`, then `quickshell log -i <instance> -t 100`.
- **The debug hatch is `omarchy-shell io.github.andressm415.omaprox diagnose`**,
  which dumps credential state, host resolution, per-type counts, the cursor
  position and the last error as JSON. It is how most of the bugs below were
  found.
- **curl config booleans are bare words.** `insecure = true` is rejected as
  "unsupported trailing garbage" and kills the whole request.
- **Proxmox answers 401 with a body that looks like a successful empty one**, so
  the HTTP status has to be captured separately — `write-out = "\n%{http_code}"`
  — or a rejected token is indistinguishable from an empty cluster.
- **`hostLabel` must not shorten an address.** Trimming at the first dot turns a
  perfectly good title into `10`, and the panel spent a while calling itself
  `127`.
- **A `TextField` holds its own text independently of the property bound to it.**
  Clearing `filter` on reopen without clearing `filterField.text` left the last
  search visible in the box, and the next keystroke appended to it.
- **Check Nerd Font codepoints before using them.** Read the installed font's
  charset rather than trusting a chart; a missing glyph renders as tofu or, worse,
  as an unrelated character that looks deliberate.
- **`secret-tool search` splits its output across both streams.** The label and
  the secret go to stdout; the *attributes* go to stderr. `2>/dev/null` throws
  away the very fields you were searching for, silently. Read attributes with
  `2>&1 >/dev/null`, which also keeps the secret out of the pipe.
- **A detached GUI client cannot ask for a password.** FreeRDP prompts on its
  controlling terminal, so `execDetached` turned every Windows console into a
  button that did nothing at all, with no error anywhere. The fix is not "always
  wrap it in a terminal" but "give it a terminal only when it has something to
  ask" — the helper decides by testing whether stdin is a tty.
- **Store a credential when it is verified, not when the session ends.** The
  first version saved only after `xfreerdp` exited 0, which never happens when
  you close the window normally, so nothing was ever remembered. `+auth-only`
  checks a password in about a second without opening anything.
- **FreeRDP's exit status does not tell you why it failed.** Wrong password
  gives 134 and an unreachable host gives 141 — both signal codes from an
  abort, not answers. The `ERRCONNECT_*` token in the output is the real signal.
- **Do not infer success from FreeRDP's log.** `+auth-only` reports a *cancelled
  connection* when it tears the link down after a login that worked, which
  pattern-matches as a failure and made correct passwords look like an
  unreachable host. Check the port yourself with a TCP connect, then treat only
  an explicit `LOGON_FAILURE`/`ACCESS_DENIED`-class token as bad credentials and
  everything else as fine.
- **Do not verify with `+auth-only` and then connect for real.** Authenticating,
  dropping the connection and immediately reconnecting makes Windows take a
  minute or more to admit the second one — the desktop opens as a black window
  and hangs there, where a single connection is instant. Connect once and read
  the outcome from that connection as it happens: a rejection lands in about
  half a second, so anything still healthy after a few seconds authenticated.
- **`FileView` cannot watch a file in a directory that does not exist.**
  `QFileSystemWatcher::addPath` fails silently on a missing directory and never
  retries, so a plugin enabled before its config directory existed watches
  nothing forever. Create the directory first.

## Marketplace

Listed via [omarchyplugins.com](https://omarchyplugins.com). Conformance:

- public repo with `manifest.json` at the root
- all eight required manifest fields: `schemaVersion`, `id`, `name`, `version`,
  `author`, `description`, `kinds`, `entryPoints`
- `README.md` and `LICENSE` present
- safe install and removal — a git checkout with no install hooks
- `preview.png` for the listing card
- passes `omarchy plugin validate`

The preview image is a real screenshot of the plugin driven against a stand-in
Proxmox API serving fabricated hosts and figures. No real cluster is shown.

Category: **System**. Tags: **Quickshell**, **Bar**, **System**.

## Layout

```
manifest.json      id, kind, entry point, settings schema
Panel.qml          bar icon, panel, cursor, row components
Service.qml        credentials, polling, per-guest fetches, console launcher
Api.js             URLs, curl config, response parsing, command templates
Model.js           row shaping, formatting, health rules
ProxmoxIcon.qml    the mark, drawn from primitives
bin/omaprox-rdp keyring-backed credentials for Windows consoles
bin/omaprox-ssh one-time SSH key setup so consoles stop asking
```

`qs.Ui` and `qs.Commons` are imported directly — `qs` is an engine-global import
path, so a third-party plugin resolves them exactly as a first-party one does.
Nothing is vendored.
