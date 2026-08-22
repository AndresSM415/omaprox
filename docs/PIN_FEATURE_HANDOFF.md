# Omaprox pin-feature handoff

State of investigation after two implementation attempts. Written for the
next agent picking this up — everything below was verified empirically
against a live quickshell harness unless marked as hypothesis.

## Goal

A pin control for the bar-widget panel: when pinned, the dashboard stays on
screen instead of dismissing on outside click, and the user can interact
with other apps normally (especially typing).

## Current branch state

- Branch `feat/pin-panel` (local only, not pushed), HEAD = `cbeef30`.
- `8af6420` + `cbeef30` = **pin v1, works**: pin button (top-right of hero)
  and `p` key toggle a `pinned` bool; outside clicks are ignored.
- The floating-window rewrite (`84feb5a`) **passed all headless tests but is
  broken in real use**; it was reset away. Details below so it isn't repeated.
- `develop` = `7c49cac`, contains earlier merged work: smooth meters +
  `smoothMeters` setting, node-meter persistence fix, alert hysteresis.
  All shipped features live there; do not regress them.

## Architecture facts discovered (verified)

### 1. How outside-click dismissal works

`qs.Ui.KeyboardPanel` (read-only shell component at
`/usr/share/omarchy/shell/Ui/KeyboardPanel.qml`) implements dismissal with a
fullscreen MouseArea (`dismissArea`, line ~280) plus per-screen twin windows
(namespace `omarchy-keyboard-panel-dismiss`). Its close path:

```qml
function close() {
  if (owner && "close" in owner) owner.close()   // ← delegates to the plugin!
  else root.open = false
}
```

The plugin passes `owner: root`. Therefore shadowing `close()` on the
widget root intercepts every dismissal. QML method dispatch resolves to the
most-derived override, so base `toggle()`/IPC also funnel through it.

### 2. Why pinned overlay locks the keyboard (the unsolved limitation)

```qml
WlrLayershell.keyboardFocus: open
  ? (focusPrimed ? WlrKeyboardFocus.OnDemand : WlrKeyboardFocus.Exclusive)
  : WlrKeyboardFocus.None
```

Steady state while open is **OnDemand** after a brief Exclusive prime.
Hyprland gives keyboard to an OnDemand layer surface when it maps and does
NOT move keyboard focus when the user clicks empty desktop / another
monitor area — only clicking an actual toplevel may take it (and even then
behavior was reported broken). Net effect: with v1 pinned, typing anywhere
else stays captured by the panel. This is inherent to keeping the dashboard
as an overlay surface; no guard-style hack fixes it.

### 3. FloatingWindow exists and is the intended escape hatch

- Type: `FloatingWindow` from `import Quickshell` (regular xdg toplevel,
  normal focus semantics).
- Reference implementation: `/usr/share/omarchy/shell/plugins/dev-gallery/
  GalleryPanel.qml` (~line 277): FloatingWindow + FocusScope{focus:true} +
  `PanelKeyCatcher` for panel-style j/k/esc dispatch inside a plain window.
- API notes (from `/usr/lib/qt6/qml/Quickshell/_Window/quickshell-window.qmltypes`):
  - Has: `title, color, implicitWidth/Height, minimumSize/maximumSize,
    visible, screen, aboveWindows, grabFocus, mask, surfaceFormat`.
  - Has **NO `x`/`y`**. Compositor chooses first placement; reposition via
    `Hyprland.dispatch("movewindowpixel exact <x> <y>,title:<title>")`
    after mapping (absolute desktop coords). `relativeX/Y` exist only on
    popup windows — do not confuse them.
- `PopupCard.qml` (qs.Ui) is a third host: `PopupWindow` +
  `HyprlandFocusGrab`; used for mouse-driven popups, not keyboard panels.
- Panel-kind plugins are loaded by shell.qml through Loaders that keep the
  instance alive ("the plugin's FloatingWindow + state survive between
  summons") — a floating window owned by the plugin is an expected pattern.

### 4. Inline-component cycle pitfall

Declaring `component DashboardBody: Item {...}` inside Panel.qml while its
instances sit in hosts in the SAME file, where the body references other
inline components declared later in that file (GuestRow etc.), fails with:

> `Inline components form a cycle!`

Solution attempted: move the body to its own file. That worked structurally
(see v2 below) but shipped broken anyway.

### 5. Test rig (rebuildable, was under /tmp/opencode/rig — ephemeral!)

Headless-ish harness that instantiates the real Panel.qml under a real
Wayland session:

- Mock PVE API: python http.server serving `/api2/json/cluster/resources`,
  `/nodes/{n}/{type}/{id}/config`, `/nodes/{n}/{type}/{id}/status/current`
  wrapped `{data: ...}`, auth header `PVEAPIToken=<token>` else deceptive
  401-with-empty-body (mirrors real PVE). State in state.json, mutated
  between polls.
- Token file trick: `credentialsPath` setting → rig token whose host line
  is `http://127.0.0.1:8999`.
- Harness `shell.qml`: symlink `Commons`,`Ui` → `/usr/share/omarchy/shell/*`
  and `plugin` → worktree dir; instantiate `plugin.Panel` with settings
  pointing at rig token; drive phases with a Timer; find internals by tree
  walking (`Item.data` includes non-Item children like PanelWindow;
  dedupe traversal or you get exponential re-visits).
- Run: `TEST_MODE=<mode> quickshell -p shell.qml` (needs Wayland session;
  QT_QPA_PLATFORM=offscreen fails — KeyboardPanel requires layer-shell).
- Modes built: pr1 (setting toggle), pr2 (+ delegate persistence/glide/
  hysteresis probes), pin (host assertions). Assertions included object-
  identity checks across polls (delegate/slot persistence), frame sampling
  of meter fill width (glide), ListView.currentIndex stability.
- Rig bugs to avoid: stopping the scheduler Timer mid-phases (deadlock);
  `pgrep -f` matching its own command line; Item.data vs .children double
  walk.

## What v2 did (reset away, but instructive)

Split `Panel.qml` into controller+hosts and `PanelBody.qml` (entire visual
body: keyCatcher/header/filter/list/legend + all row components).
Dependencies injected as `property var ctrl` (widget root) and
`property var pve` (service); all internal `root.` references rewritten to
`ctrl.`. Hosts: KeyboardPanel (open: opened && !pinned) and FloatingWindow
(visible: pinned && opened), each embedding PanelBody. Position via
movewindowpixel dispatch after map.

All 11 pin-mode + 18 regression checks PASSED headless: overlay hid, float
showed, rows rendered in float mode, close/unpin/toggle semantics right,
and none of the earlier features regressed.

## Why it still failed live (open question)

User report: "completely borken" in real use — no further symptom detail
captured before revert. Hypotheses ranked for the next agent:

1. **Dual live instances of the body**: both hosts instantiate PanelBody at
   once (overlay hidden but alive). Two PanelKeyCatchers, two filterFields,
   duplicate focus targets, double IPC-ish side effects. Headless rig never
   exercised real focus competition. Fix candidate: single body reparented
   between hosts (ReparentingLoader / `parent` swap) or destroy-overlay-
   entirely while pinned instead of hiding.
2. **Sizing/layout**: body previously relied on KeyboardPanel's
   contentHolder sizing; in FloatingWindow it sat in FocusScope with
   anchors.fill — width-capped list/hero logic (fittedContentWidth) lived on
   the host and may not transfer; content could render zero-width/misplaced.
3. **movewindowpixel timing/title selector**: dispatch fires immediately on
   visibleChanged; window may not be mapped yet, and title selector needs
   initial placement rules (Hyprland windowrule for `title:Omaprox` might be
   more reliable).
4. **Layer vs toplevel z-order/keyboard interplay**: bar remains an overlay;
   float window opens UNDER overlays? Clicking the bar icon again routes
   through dismissArea of... overlay closed, so probably fine.
5. Hyprland version specifics for OnDemand layer surfaces (check
   `hyprctl layers` while pinned-v1 to confirm who holds keyboard).

## Suggested next steps

1. Reproduce v2 breakage locally with the rig PLUS a real interaction pass
   (rig asserts structure, not human-visible layout/focus).
2. Prefer **single-host swap**: one PanelBody instance moved between hosts
   (or hosts toggled with Loader active=false on the inactive one) to kill
   dual-instance hazards.
3. Alternative lighter design if floating proves cursed: keep overlay
   pinned but flip `WlrLayershell.keyboardFocus` to None while pinned and
   require click-inside-to-focus for keys (loses always-on j/k; keeps
   typing freedom). Verify Hyprland lets a click refocus an OnDemand layer.
4. Persist the rig into the repo (tools/) — it caught every regression so
   far and the inline-cycle/API pitfalls cost hours.

## File map (post-revert)

- `Panel.qml` — widget root: theme, cursor/state machine, reconcileRows,
  lifecycle, IPC hatch, BarIconButton, KeyboardPanel host, pin v1 guard.
- `Service.qml` — credentials/polling/console launchers, alarmMemo,
  smoothMeters/showRunningCount settings.
- `Model.js` — pure row shaping; ALARM_CLEAR_BAND hysteresis; glyphFor
  (pin glyph `\uf04a`, verified present in JetBrainsMono Nerd Font).
- `Api.js` — URLs/curl config/parsers.
- Local branches: `feat/pin-panel` (v1 pin @cbeef30 + this doc),
  `wip-local` (author's older ~700-line WIP snapshot), plus PR branches.
