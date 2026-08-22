# Omaprox pin-feature notes

The pin feature works. This file was a handoff written after two failed
attempts; it is kept because the architecture facts in it are hard-won and
still true, and because one open issue remains. Everything below was verified
empirically against the running shell on a two-monitor Hyprland session.

## Goal

A pin control for the bar-widget panel: when pinned, the dashboard stays on
screen instead of dismissing on outside click, and the user can interact with
other apps normally (especially typing).

## Status

- **Done.** Pinned, the panel stays up; clicking another window focuses it and
  gives it the keyboard; clicking back on the card returns the keyboard to the
  panel and `j`/`k` work again.
- **Gated.** Because of the issue below, the pin is only offered when
  `Quickshell.screens.length <= 1`. On more than one output the button and the
  `p` key are gone, and a panel that is pinned when a second monitor arrives
  unpins itself. Shipping it half-working reads as a broken desktop rather than
  a limited feature.
- **Open:** on a multi-monitor setup, clicks on whichever monitor the panel is
  *not* on would be swallowed while pinned. See "Remaining issue" below.

  This is not laptop-versus-external. The bar runs on every output, so the
  panel opens on whichever bar you clicked, and that output is the one that
  works — verified in both directions on the same session.
- **Upstream:** a `dismissable` property for `qs.Ui.KeyboardPanel` is written
  and verified against a patched shell on this hardware; once it lands, drop
  the gate and set `dismissable: !pinned` instead of the mask override.

## What the problem actually was

The previous two attempts read the symptom as a **keyboard-focus** problem and
went looking for a host with different focus semantics — hence the
FloatingWindow rewrite, which passed every headless assertion and was broken in
real use.

It was a **pointer** problem.

`qs.Ui.KeyboardPanel` sets its input region to the entire screen:

```qml
mask: Region {
  width: root.screenW
  height: root.screenH
}
```

It has to, for the unpinned case: outside-click dismissal only works if the
overlay actually receives the outside click. But a pinned panel does not
dismiss, so while pinned that fullscreen region does nothing except swallow
every click meant for another window.

That is also the whole explanation for the "pinned panel locks the keyboard"
symptom. The layer's steady state is `WlrKeyboardFocus.OnDemand`, and Hyprland
*does* move keyboard focus off an OnDemand surface when you click a toplevel —
but the click was being intercepted before it ever reached a toplevel, so the
compositor was never asked to move anything. Nothing was wrong with the focus
mode. The earlier note that this was "inherent to keeping the dashboard as an
overlay surface" is wrong, and the FloatingWindow direction it justified is
unnecessary.

## The fix

Six lines in `Panel.qml`, on the existing `KeyboardPanel` host — the instance's
binding overrides the component's own:

```qml
mask: Region {
  x: root.pinned ? panel.cardOrigin.x : 0
  y: root.pinned ? panel.cardOrigin.y : 0
  width: root.pinned ? panel.contentWidth : panel.screenW
  height: root.pinned ? panel.contentHeight : panel.screenH
}
```

`cardOrigin`, `contentWidth/Height`, `screenW/H` are all public readonly
properties of KeyboardPanel, and the card is drawn at exactly that rect.

No second host, no body split, no `Inline components form a cycle!`, no
`movewindowpixel` dispatch, and nothing to keep in sync between two live
instances.

## Verified behaviour

Checked by hand against the running shell, not the rig:

| Case | Result |
|---|---|
| Pinned, click a window on the panel's monitor | window focuses, panel stays open |
| Pinned, type into that window | every character arrives, including `c`/`h`/`t`/`o`/`p`/`r` |
| Pinned, click back on the card, press `j` | cursor moves — panel has the keyboard again |
| Pinned, click the bar icon | force-closes and unpins, as before |
| Unpin, then click outside | closes normally |
| Unpinned throughout | unchanged from before the patch |

The `c`/`h` check matters: those are panel keybindings, and their arriving in
the other window is the proof that the panel is not merely *ignoring* keys but
genuinely not receiving them.

## Remaining issue: other monitors

`KeyboardPanel` gives every *other* output a transparent full-screen twin whose
only job is to catch a click there and dismiss:

```qml
Variants {
  model: root.open ? Quickshell.screens : []
  ...
  MouseArea { anchors.fill: parent; onPressed: root.close() }
}
```

While pinned, that `close()` is correctly a no-op — but the click is still
swallowed, so a window on the other output does not focus. Verified both ways
on a two-monitor session: with the panel opened from the eDP-1 bar, clicks on
DP-1 were swallowed; opened from the DP-1 bar, the twin moved to eDP-1 and the
swallowing moved with it. The failing output is always the one the panel is not
on.

The twins are created inside the component with no `id` or alias reachable from
the plugin, and they are gated only on `root.open`, which cannot be false while
the card is visible. So this is **not fixable from the plugin**; it needs a
change in `/usr/share/omarchy/shell/Ui/KeyboardPanel.qml`, which is
package-owned and must not be edited locally.

Suggested upstream shape: expose a `dismissable` property (default true) that
gates both `dismissArea.enabled` and the `Variants` model, so an owner that has
overridden `close()` into a no-op can say so and stop paying for dismissal it
does not use. Worth filing against omarchy rather than working around.

Rejected workarounds, so they are not retried:

- Overriding `screen: null` on the instance does remove every twin, since the
  delegate tests `!!root.screen` — but `screen` also decides which output the
  panel itself maps to and feeds `screenW`/`screenH`, so the card jumps to the
  primary output the moment you pin it.
- A plugin-owned surface stacked above the twin cannot help either way: an
  empty input region lets the click fall through to the twin, and a non-empty
  one swallows it just the same. A Wayland surface cannot forward a click to
  the toplevel underneath it.

## Architecture facts (still accurate, keep)

### Outside-click dismissal delegates to the plugin

`KeyboardPanel.close()` is:

```qml
function close() {
  if (owner && "close" in owner) owner.close()
  else root.open = false
}
```

The plugin passes `owner: root`, so shadowing `close()` on the widget root
intercepts every dismissal — that is what pin v1 (`8af6420`, `cbeef30`) is
built on, and it still stands. Explicit closes route through `forceClose()`.

### Keyboard focus

```qml
WlrLayershell.keyboardFocus: open
  ? (focusPrimed ? WlrKeyboardFocus.OnDemand : WlrKeyboardFocus.Exclusive)
  : WlrKeyboardFocus.None
```

A 75ms Exclusive prime on open, then OnDemand. Left alone by the fix. Qt
restores active focus to the previous focus item when the surface regains
keyboard focus, so clicking back into the panel needs no explicit
`forceActiveFocus()` — confirmed, `j` works immediately after clicking the card.

### FloatingWindow, if it is ever needed for something else

- `FloatingWindow` from `import Quickshell`; regular xdg toplevel.
- Reference: `/usr/share/omarchy/shell/plugins/dev-gallery/GalleryPanel.qml`.
- Has **no `x`/`y`** — the compositor places it; reposition with
  `Hyprland.dispatch("movewindowpixel exact <x> <y>,title:<title>")` after it
  maps. `relativeX/Y` exist only on popup windows.
- Declaring `component DashboardBody: Item {...}` in `Panel.qml` while it
  references other inline components declared later in the same file fails with
  `Inline components form a cycle!`. Moving the body to its own file is the
  structural fix, but see above — none of this is needed for the pin.

### Test rig

The headless rig described in the original handoff passed all 29 checks on the
version that was broken in real use, and would have passed on the version with
the pointer bug too: it asserts structure, and this was a compositor input
region. Anything touching pointer or focus behaviour has to be checked by hand
against a real session — `hyprctl layers`, `hyprctl activewindow`, and typing
into a scratch window are enough and take a minute.

## File map

- `Panel.qml` — widget root: theme, cursor/state machine, reconcileRows,
  lifecycle, IPC hatch, BarIconButton, KeyboardPanel host, pin guard + mask.
- `Service.qml` — credentials/polling/console launchers, alarmMemo,
  smoothMeters/showRunningCount settings.
- `Model.js` — pure row shaping; ALARM_CLEAR_BAND hysteresis; glyphFor
  (pin glyph ``, verified present in JetBrainsMono Nerd Font).
- `Api.js` — URLs/curl config/parsers.
