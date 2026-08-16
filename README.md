# Omaprox — Proxmox VE in the Omarchy bar

Every container and VM on your cluster, each with a status light, the stats
behind any one of them, and one key to a console — `pct enter` for containers,
SSH for Linux VMs, `xfreerdp3` for Windows.

It is a dashboard, not a control panel. Nothing in it starts, stops, migrates,
snapshots or reconfigures a guest. The only thing it opens is a window you were
going to open anyway.

Built for Omarchy 4 (`shell/plugins`, `manifest.json`, `~/.config/omarchy/plugins/`).

![The overview and one guest](preview.png)

## Install

```bash
omarchy plugin add https://github.com/AndresSM415/omaprox.git
omarchy plugin enable io.github.andressm415.omaprox
omarchy bar move io.github.andressm415.omaprox      # optional, to place it
```

Plugins land disabled so you can read the code first. Removal is
`omarchy plugin remove io.github.andressm415.omaprox` — the plugin is a plain
git checkout and installs nothing outside its own directory: no hooks, no sudo,
no files elsewhere on the system.

## Setup

Two things: where the cluster is, and a token to read it with. Until both are
present the panel shows exactly which one is missing.

**1. Mint a token, then grant it a role — two separate screens.**

*Datacenter → Permissions → API Tokens → Add* creates the token itself: user,
token ID, an *Expire* date if you want one, and *Privilege Separation* ticked.
That dialog has no role or privilege picker — that is correct, not a step you
missed. A freshly minted token can do nothing at all until a role is granted to
it explicitly, which happens on a different screen:

*Datacenter → Permissions → Permissions* (the tab one over from *API Tokens*)
*→ Add → API Token Permission*:

| Field | Value |
|---|---|
| Path | `/` |
| API Token | `user@realm!tokenid` — the token you just created |
| Role | `PVEAuditor`, or a custom role with only `VM.Audit`, `Sys.Audit`, `Datastore.Audit` |
| Propagate | ticked, so the role reaches every node and guest under `/` |

The stock `PVEAuditor` role covers exactly those three privileges and nothing
else. **A token that cannot stop a VM cannot stop a VM by accident** — that
guarantee is the reason the plugin asks for so little, and it is worth keeping.

**2. Write it to a file:**

```bash
mkdir -p ~/.config/omaprox
printf 'host = pve01.lan\nroot@pam!omarchy=00000000-0000-0000-0000-000000000000\n' \
  > ~/.config/omaprox/token
chmod 600 ~/.config/omaprox/token
```

The token lives in a file rather than in `shell.json` on purpose: `shell.json`
is a config file people paste into issues and copy between machines, and an API
token should not travel with it. The file is watched, so editing it takes effect
without a restart.

`host` can also go in `shell.json` if you prefer; the file wins when both are
set. `pve01.lan`, `10.0.20.2` and `https://pve01.lan:8006` are all accepted —
the scheme defaults to `https` and the port to `8006`.

**TLS.** Proxmox self-signs, so certificate verification is off by default.
Point `caCert` at your CA, or set `verifyTls` to `On` once the node has a real
certificate.

## What the panel shows

**Overview** — needs attention, then nodes, then containers, then VMs.

| Section | Contents |
|---|---|
| Needs attention | guests and nodes with something wrong, **by name** — a count of broken things is not actionable. Absent entirely when nothing is wrong, so its presence is the signal |
| Nodes | CPU and memory per node, as two labelled meters. Two rather than one because the number that matters is usually memory, and a single unlabelled bar never said which |
| Containers / Virtual machines | one row per guest: console button, status light, vmid, name, OS and uptime, then CPU and memory |

**A guest** — Enter on any row. CPU, memory, swap (containers), disk, network
and disk I/O since boot, then uptime, OS, address, guest agent, autostart and
node. `h` or Escape comes back, and the cursor returns to where you left it.

**Search** — `/` matches name, vmid, node and OS, from anywhere including from
inside a guest.

## The status light

Status is carried by **form and brightness, not hue**. Omarchy themes are
frequently monochrome — the default palette sets `foreground` and `accent` to
the same grey — so a green "running" dot would be a colour belonging to no
theme. `urgent` is the one semantic colour every theme defines, so it is the
only one used, and only for things that are wrong. Every non-running row also
prints its state as text, so the light is a scan aid rather than the only
channel.

| Light | Meaning |
|---|---|
| filled, haloed | running |
| hollow ring | stopped |
| dimmed disc | paused or suspended |
| `urgent`, haloed | something is wrong — see below |

Something is wrong when a running guest is over `memWarnPercent` of its memory,
when HA has put it in `error` or `fence`, when a node is offline or over the
same memory threshold, or when a **stopped guest has autostart on**. That last
one is the single most common thing worth catching on a cluster and nothing else
would show it: a dark light on a guest that is meant to be dark looks identical
to one that should be running.

## The console button

The left edge of every guest row, and `t` from the keyboard.

| Guest | Opens |
|---|---|
| Container | `pct enter <vmid>` over SSH to its node |
| Linux VM | SSH to the guest itself |
| Windows VM | a remote desktop, with no terminal once credentials are known |
| Stopped | nothing. The button stays in place, dimmed and inert, rather than vanishing — a row that changes width when a guest shuts down makes the whole list jump |

On a **single node** the container console addresses the node by the same
address the API is on, because a node name like `pve` usually resolves to
nothing. On a **cluster** it uses the node name, since `pct enter` has to run on
the node the container is actually on — give those names to `/etc/hosts` or your
resolver.

The SSH consoles run in a floating terminal, titled with the guest — `w11 · VM
102` — so a screenful of consoles is tellable apart. It is deliberately **not**
launched through `omarchy-launch-floating-terminal-with-presentation`, which
paints the Omarchy logo over a window whose entire job is to tell you about one
guest. The window closes with the session, and holds open only if the command
failed, so an error stays on screen instead of flashing past.

A remote desktop opens **no terminal at all** once its credentials are saved.
Before that it opens one to ask, and closes it again as the desktop appears.

## Credentials for a console

Both kinds ask once and then stop asking — by different means, because the right
answer is different.

**Containers and Linux VMs** go through `bin/omaprox-ssh`. The first time a
host wants a password it offers to install your public key, and every connection
after that is silent. Say no and it just connects, asking each time as before.

No SSH password is stored anywhere, deliberately. An authorized key is the
better version of "remember me": the server remembers it, it survives a password
change, it can be revoked on its own, and it is never transmitted.

**Windows VMs** go through `bin/omaprox-rdp`, which asks once and remembers:

1. First connection opens a small terminal asking for username, password, and
   domain — leave the domain **blank for a local account**, which is what a
   workgroup PC has. That terminal closes as soon as the desktop opens.
2. The password goes into your **login keyring** through libsecret, under
   `service=omaprox host=<address>`, the moment it is confirmed to work —
   verified with `+auth-only`, which checks it without opening a window.
3. Every later connection finds it and goes **straight to the desktop with no
   terminal at all**.
4. If the server ever rejects a saved password, it is **deleted** and you are
   asked again. Stored credentials that silently fail forever are worse than
   none.

Inspect or remove a saved password yourself:

```bash
secret-tool search service omaprox          # attributes print on stderr
secret-tool clear service omaprox host 192.168.1.50
```

**No password is ever written to `shell.json`, and none is ever passed on the
command line.** FreeRDP gets its arguments on a pipe via `/args-from:stdin`,
because `/proc/<pid>/cmdline` is world-readable and a `/p:` argument would show
the password to every process on the machine. `rdpUser` exists only to pre-fill
the username; there is deliberately no password setting to go with it.

Setting your own `rdpCommand` bypasses the helper entirely — then credentials
are yours to handle.

**Kerberos.** The helper passes `/auth-pkg-list:none,ntlm`. Without it, FreeRDP
tries Kerberos first, and on a machine with a stock `/etc/krb5.conf` — whose
`default_realm` is `ATHENA.MIT.EDU` — it spends several seconds failing against
MIT's realm and fills the window with `krb5_init_creds_get` errors that have
nothing to do with your login.

A Windows guest shows a display icon instead of a shell prompt, because what
that button opens is a desktop session and the icon should say so before you
press it. Windows is detected from the VM's `ostype`, which Proxmox prefixes
with `w` for every version of it.

**The address** is resolved in this order: an override you set, then the
container's own `net0` address, then the guest agent if you turned that on, then
the guest's name as a hostname. Reading a VM's address from the agent is the one
call that needs `VM.Monitor` rather than `VM.Audit`, so it is **off by default**
— keeping the token strictly read-only is worth more than saving you a DNS
entry. Override per guest in `shell.json` when a name will not resolve:

```jsonc
{ "id": "io.github.andressm415.omaprox", "addresses": { "202": "10.0.20.42" } }
```

Every command is a template you can replace — see the settings table. Values are
substituted and shell-quoted, never interpolated: a guest named `; rm -rf ~`
stays a string.

## Keys

| Key | Action |
|---|---|
| `j` / `k`, arrows | move the cursor |
| `l` / Enter | open a guest's stats; on a node, open it in the web UI |
| `h` / Escape | back out one level, then close the panel |
| `t` | console — terminal, or remote desktop for Windows |
| `o` | open the Proxmox web UI at this guest |
| `c` | copy the address |
| `/` | search; Escape leaves search |
| `r` | refresh now |
| `Tab` | move to the next bar panel |

Mouse: left click toggles the panel, right click refreshes, middle click opens
the web UI. Inside the panel, clicking a row opens its stats and clicking the
left-edge button opens a console — two destinations, two targets.

## Settings

Edit the widget's entry in `~/.config/omarchy/shell.json`.

```jsonc
{ "id": "io.github.andressm415.omaprox", "host": "pve01.lan", "refreshIntervalSec": 10 }
```

| Key | Default | Meaning |
|---|---|---|
| `host` | — | any node in the cluster; scheme and port are filled in |
| `credentialsPath` | `~/.config/omaprox/token` | where the token file lives |
| `refreshIntervalSec` | 10 | cluster poll; the open guest's own stats refresh at the same rate |
| `verifyTls` | `Off` | Proxmox self-signs, so verification starts off |
| `caCert` | — | PEM for your CA; setting it verifies regardless of `verifyTls` |
| `nodeSshUser` | `root` | user for the container console, which lands on the node |
| `guestSshUser` | `root` | user for the Linux VM console, which lands on the guest |
| `rdpUser` | — | Windows username, so FreeRDP asks only for the password. No password setting exists by design |
| `lxcConsoleCommand` | `ssh -t {nodeUser}@{node} pct enter {vmid}` | runs in a floating terminal |
| `vmConsoleCommand` | `ssh -t {guestUser}@{address}` | runs in a floating terminal |
| `rdpCommand` | `xfreerdp3 /v:{address} /dynamic-resolution +clipboard` | launched directly |
| `memWarnPercent` | 90 | memory share that turns a light red |
| `showTemplates` | `Off` | templates never run, so they would be permanently dark rows |
| `agentAddresses` | `Off` | read VM addresses from the guest agent; needs `VM.Monitor` |
| `addresses` | — | per-vmid address overrides, keyed by vmid as a string |

Placeholders in the three command templates: `{vmid}` `{name}` `{node}`
`{host}` `{address}` `{nodeUser}` `{guestUser}` `{rdpUser}`.

**If your node names do not resolve** — common when you reach Proxmox by IP and
have no local DNS — the default container console fails with a name lookup
error, because `{node}` is a Proxmox node *name*, not necessarily a hostname.
On a single node, use `{host}` instead:

```jsonc
{ "id": "io.github.andressm415.omaprox",
  "lxcConsoleCommand": "ssh -t {nodeUser}@{host} pct enter {vmid}" }
```

On a cluster, `pct enter` has to run on the node the container is actually on,
so keep `{node}` and give the node names to `/etc/hosts` or your resolver.

## Cost

One request per poll. `/cluster/resources` returns every node and every guest on
the whole cluster in a single call, however many nodes there are.

Per-guest config — OS, autostart, container address — is fetched once per guest
and cached for the session, one at a time so a forty-guest cluster does not open
forty sockets on the first poll. Failures are cached too, so a guest whose config
cannot be read is not re-requested forever.

Per-guest **status** is only fetched for the guest you have open. With the panel
closed, the plugin makes one request every `refreshIntervalSec` and nothing else.

## Credentials

The token is written to curl's stdin as a config file (`curl -K -`), never into
argv. `/proc/<pid>/cmdline` is world-readable; a
`-H "Authorization: PVEAPIToken=…"` argument would expose the token to every
process on the machine.

## What it does not do

**It does not write.** No start, stop, reboot, shutdown, migrate, snapshot,
backup, or config change. Proxmox's own web UI is better at all of those and it
is one keypress away on `o`. The read-only boundary is the feature, not a
limitation — it is why the token can be `PVEAuditor` and why leaving this on
your bar costs you nothing.

**It does not show a VM's disk usage.** Proxmox reports what the *host* has
allocated, which for most storage types is `0` — an empty bar claiming the disk
is empty would be worse than no bar, so VMs get "120 GB allocated" as a plain
fact instead. Containers report real usage and do get a meter.

**It does not do VNC/SPICE.** The console button opens a terminal or an RDP
client, both of which are better than a browser console when they are available.
For a VM with neither, `o` opens the Proxmox console.

## Development notes

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

## License

MIT. Not affiliated with or endorsed by Proxmox Server Solutions GmbH; the mark
in the bar is a generic stack of plates, deliberately not the Proxmox logo.
