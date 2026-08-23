// Formatting and row shaping. Pure functions only — the panel renders whatever
// the build* functions return and holds no knowledge of Proxmox response
// shapes.
//
// Information architecture:
//
//   overview   what needs attention, how loaded each node is, then every
//              container and every VM as one row apiece
//   guest      one guest's meters, traffic and facts
//   search     one flat list of guests, reachable from anywhere
//
// The overview lists guests individually rather than as counts — unlike a
// cloud account with ninety resources, a cluster has a few dozen guests and
// the list *is* the dashboard. Which one is dark is the thing you opened the
// panel to see.

// ---------------------------------------------------------------- formatting

var UNITS = ["B", "K", "M", "G", "T", "P"]

// Compact, for the right edge of a list row where the column is 60px wide.
function shortBytes(bytes) {
  var n = Number(bytes)
  if (!isFinite(n) || n <= 0) return "0"
  var i = 0
  while (n >= 1024 && i < UNITS.length - 1) { n /= 1024; i++ }
  return (n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)) + UNITS[i]
}

// Spelled out, for the detail view where there is room to be unambiguous.
function formatBytes(bytes) {
  var n = Number(bytes)
  if (!isFinite(n) || n <= 0) return "0 B"
  var units = ["B", "KB", "MB", "GB", "TB", "PB"]
  var i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return (n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)) + " " + units[i]
}

function formatRate(bytesPerSecond) {
  var n = Number(bytesPerSecond)
  if (!isFinite(n) || n <= 0) return "0 B/s"
  return formatBytes(n) + "/s"
}

function formatPercent(fraction) {
  var n = Number(fraction)
  if (!isFinite(n) || n < 0) return "—"
  var pct = n * 100
  // Exactly nothing is "0%", not "0.0%" — the decimal implies a measurement
  // too small to show, when in fact there is nothing there.
  if (pct <= 0) return "0%"
  return (pct >= 10 ? Math.round(pct) : pct.toFixed(1)) + "%"
}

// Coarse on purpose. An uptime list is scanned, not read: "12d" carries what
// matters in a third of the width of "12 days, 4 hours".
function formatUptime(seconds) {
  var s = Math.max(0, Math.floor(Number(seconds) || 0))
  if (s <= 0) return ""
  var days = Math.floor(s / 86400)
  var hours = Math.floor((s % 86400) / 3600)
  var minutes = Math.floor((s % 3600) / 60)
  // The smaller unit is dropped when it is zero: a box up for exactly six
  // weeks should read "42d", not "42d 0h".
  if (days > 0) return hours > 0 ? days + "d " + hours + "h" : days + "d"
  if (hours > 0) return minutes > 0 ? hours + "h " + minutes + "m" : hours + "h"
  return minutes + "m"
}

// The long form, for the one row in the detail view that has space for it.
function formatUptimeLong(seconds) {
  var s = Math.max(0, Math.floor(Number(seconds) || 0))
  if (s <= 0) return "—"
  var days = Math.floor(s / 86400)
  var hours = Math.floor((s % 86400) / 3600)
  var minutes = Math.floor((s % 3600) / 60)
  // Trailing zero units are dropped rather than padded: "41d 0h 0m" spends
  // two thirds of the line saying nothing happened.
  var parts = []
  if (days > 0) parts.push(days + "d")
  if (hours > 0) parts.push(hours + "h")
  if (minutes > 0 || parts.length === 0) parts.push(minutes + "m")
  return parts.join(" ")
}

// ---------------------------------------------------------------- glyphs

// Escapes rather than literal characters, and every codepoint checked against
// the shipped Nerd Font's charset first: a glyph the family lacks renders as a
// tofu box or, worse, as an unrelated character that looks deliberate.
function glyphFor(kind) {
  switch (kind) {
  case "lxc":      return ""  // box
  case "qemu":     return ""  // server
  case "node":     return ""  // hdd
  case "terminal": return ""  // terminal
  case "rdp":      return ""  // desktop
  case "windows":  return ""  // windows
  case "linux":    return ""  // linux
  case "lock":     return ""  // lock
  case "web":      return "\uf0ac"  // globe
  case "reset":    return "\uf021"  // refresh
  case "pin":      return ""  // thumb tack
  }
  return ""                   // cubes
}

// ---------------------------------------------------------------- state

var RUNNING = "running"
var STOPPED = "stopped"
var PAUSED = "paused"

// One place decides what colour a guest's LED is and whether it belongs under
// Needs attention, so the list, the alert section and the bar badge can never
// disagree about the same guest.
//
// `led` is deliberately separate from `state`: a running guest that is out of
// memory is still running, and saying so in the status line while the LED goes
// red is more use than inventing a fifth state for it.
// Whether a guest's memory figure means anything.
//
// Proxmox reports a VM's memory through the balloon device. With no balloon
// driver running in the guest — the default on Windows until someone installs
// the virtio drivers — `mem` is simply `maxmem`, on every poll, forever. Read
// literally that is 100% memory, which would put a permanent red badge on the
// bar for a guest that is perfectly healthy and destroy the one signal the
// alert section exists to carry.
//
// A container's figure comes from its cgroup and is always real. A VM sitting
// at exactly its ceiling is reporting nothing, and a VM genuinely at 99.9% is
// indistinguishable from it anyway.
function memoryReported(guest) {
  if (guest.type !== "qemu") return true
  if (!(guest.maxmem > 0)) return false
  return guest.mem < guest.maxmem * 0.999
}

// A guest hovering at the memory line would otherwise flip its alert row on
// and off between polls, and every row below it on the overview would jump
// twice a minute. Once flagged, stay flagged until the share falls this far
// clear of the threshold.
var ALARM_CLEAR_BAND = 0.06

function guestHealth(guest, config, thresholds, prevAlarming) {
  var status = String(guest.status || "")
  var locked = String(guest.lock || "")
  var memFraction = guest.maxmem > 0 ? guest.mem / guest.maxmem : 0
  var health = { state: status, led: "stop", alarming: false, reason: "" }

  if (status === RUNNING) {
    health.state = RUNNING
    health.led = "run"
  } else if (status === PAUSED || status === "suspended") {
    health.state = PAUSED
    health.led = "pause"
    health.reason = "suspended"
  } else if (status === STOPPED) {
    health.state = STOPPED
    health.led = "stop"
  } else if (status !== "") {
    // Transitional states Proxmox invents mid-operation — better shown as
    // themselves than forced into one of the three we know about.
    health.state = status
    health.led = "pause"
  }

  var hastate = String(guest.hastate || "")
  if (hastate === "error" || hastate === "fence") {
    health.led = "crit"
    health.alarming = true
    health.reason = "HA " + hastate
    return health
  }

  var warnAt = thresholds.memWarn
  if (prevAlarming && thresholds.memClear > 0 && thresholds.memClear < warnAt)
    warnAt = thresholds.memClear
  if (status === RUNNING && warnAt > 0 && memFraction >= warnAt
      && memoryReported(guest)) {
    health.led = "crit"
    health.alarming = true
    health.reason = formatPercent(memFraction) + " memory"
    return health
  }

  // A guest set to start with its node but sitting stopped is the single most
  // common thing worth catching on a cluster, and nothing else on the panel
  // would show it — a dark LED on a guest that is meant to be dark looks
  // identical.
  if (status === STOPPED && config && config.onboot) {
    health.led = "crit"
    health.alarming = true
    health.reason = "stopped, autostart on"
    return health
  }

  if (locked !== "") health.reason = "locked: " + locked

  return health
}

function nodeHealth(node, thresholds, prevAlarming) {
  var memFraction = node.maxmem > 0 ? node.mem / node.maxmem : 0
  if (String(node.status || "") !== "online")
    return { alarming: true, reason: "node is " + String(node.status || "unknown") }
  var warnAt = thresholds.memWarn
  if (prevAlarming && thresholds.memClear > 0 && thresholds.memClear < warnAt)
    warnAt = thresholds.memClear
  if (warnAt > 0 && memFraction >= warnAt)
    return { alarming: true, reason: formatPercent(memFraction) + " memory" }
  return { alarming: false, reason: "" }
}

// ---------------------------------------------------------------- normalizing

function guestKey(guest) {
  return String(guest.node || "") + "/" + String(guest.type || "") + "/" + String(guest.vmid || "")
}

// /cluster/resources answers with nodes and guests in one array. Splitting it
// here means the panel never sees a raw Proxmox record.
function splitResources(raw, options) {
  var list = Array.isArray(raw) ? raw : []
  var guests = []
  var nodes = []

  for (var i = 0; i < list.length; i++) {
    var item = list[i]
    var type = String(item.type || "")

    if (type === "node") {
      nodes.push({
        kind: "node",
        name: String(item.node || ""),
        status: String(item.status || ""),
        cpu: Number(item.cpu) || 0,
        maxcpu: Number(item.maxcpu) || 0,
        mem: Number(item.mem) || 0,
        maxmem: Number(item.maxmem) || 0,
        disk: Number(item.disk) || 0,
        maxdisk: Number(item.maxdisk) || 0,
        uptime: Number(item.uptime) || 0
      })
      continue
    }

    if (type !== "lxc" && type !== "qemu") continue
    // A template never runs, so listing them by default fills the panel with
    // permanently dark LEDs that mean nothing is wrong.
    if (Number(item.template) === 1 && !options.showTemplates) continue

    guests.push({
      vmid: Number(item.vmid) || 0,
      name: String(item.name || ("vm " + item.vmid)),
      node: String(item.node || ""),
      type: type,
      status: String(item.status || ""),
      lock: String(item.lock || ""),
      hastate: String(item.hastate || ""),
      template: Number(item.template) === 1,
      cpu: Number(item.cpu) || 0,
      maxcpu: Number(item.maxcpu) || 0,
      mem: Number(item.mem) || 0,
      maxmem: Number(item.maxmem) || 0,
      disk: Number(item.disk) || 0,
      maxdisk: Number(item.maxdisk) || 0,
      uptime: Number(item.uptime) || 0,
      netin: Number(item.netin) || 0,
      netout: Number(item.netout) || 0
    })
  }

  nodes.sort(function(a, b) { return a.name.localeCompare(b.name) })
  // vmid order, which is the order they are in the Proxmox UI and the order
  // people remember their own guests in.
  guests.sort(function(a, b) { return a.vmid - b.vmid })
  return { nodes: nodes, guests: guests }
}

// ---------------------------------------------------------------- guest rows

function guestRow(guest, state) {
  var config = state.configs[guestKey(guest)] || null
  var health = guestHealth(guest, config, state.thresholds,
    !!(state.alarmMemo && state.alarmMemo[guestKey(guest)]))
  var running = guest.status === RUNNING

  var os = config ? config.osLabel : ""
  var detailParts = []
  if (health.alarming && health.reason) detailParts.push(health.reason)
  else if (health.state !== RUNNING) detailParts.push(health.reason || health.state)
  else {
    if (os) detailParts.push(os.toLowerCase())
    var up = formatUptime(guest.uptime)
    if (up) detailParts.push(up)
  }

  // A Windows VM gets a display icon rather than a shell prompt, because what
  // that button opens is a desktop session and the icon should say so before
  // you press it.
  var console = "none"
  if (running) console = config && config.windows ? "rdp" : "terminal"

  return {
    kind: "guest",
    key: guestKey(guest),
    guest: guest,
    vmid: guest.vmid,
    name: guest.name,
    node: guest.node,
    vtype: guest.type,
    glyph: glyphFor(guest.type),
    led: health.led,
    state: health.state,
    alarming: health.alarming,
    reason: health.reason,
    console: console,
    detail: detailParts.join("  ·  "),
    // An unmeasured memory figure is the guest's allocation, so it is prefixed
    // rather than printed as though it were usage.
    trailing: running
      ? formatPercent(guest.cpu) + "  ·  "
        + (memoryReported(guest) ? "" : "≤") + shortBytes(guest.mem)
      : "—",
    selectable: true
  }
}

function nodeRow(node, state) {
  var health = nodeHealth(node, state.thresholds)
  var cpuFraction = node.cpu
  var memFraction = node.maxmem > 0 ? node.mem / node.maxmem : 0

  return {
    kind: "node",
    key: "node/" + node.name,
    name: node.name,
    node: node.name,
    alarming: health.alarming,
    reason: health.reason,
    // Cores and uptime ride on the title line rather than a third meter: they
    // do not change, and a meter for a constant is decoration.
    detail: (node.maxcpu > 0 ? node.maxcpu + " cores" : "")
      + (node.uptime > 0 ? "  ·  up " + formatUptime(node.uptime) : ""),
    meters: [
      { key: "node/" + node.name + "/cpu", label: "cpu", percent: cpuFraction, text: formatPercent(cpuFraction),
        level: levelFor(cpuFraction, state.thresholds.memWarn) },
      { key: "node/" + node.name + "/mem", label: "mem", percent: memFraction,
        text: shortBytes(node.mem) + "/" + shortBytes(node.maxmem),
        level: levelFor(memFraction, state.thresholds.memWarn) }
    ],
    selectable: true
  }
}

// Amber before red, so a meter that is filling up reads differently from one
// that has arrived. The warn point sits below the alarm point rather than at
// an unrelated round number, so the two always move together.
function levelFor(fraction, alarmAt) {
  var n = Number(fraction)
  if (!isFinite(n) || n < 0) return "ok"
  if (alarmAt > 0 && n >= alarmAt) return "crit"
  if (alarmAt > 0 && n >= alarmAt - 0.15) return "warn"
  return "ok"
}

// Recomputes the alarming set against current figures, letting previously
// alarming guests clear only through the hysteresis band. Called once per
// poll by the service; the panel reads the same memo while shaping rows so
// the two can never disagree.
function updateAlarmMemo(state) {
  var prev = state.alarmMemo || {}
  var next = {}
  var i

  for (i = 0; i < state.guests.length; i++) {
    var g = state.guests[i]
    var key = guestKey(g)
    var config = state.configs[key] || null
    if (guestHealth(g, config, state.thresholds, !!prev[key]).alarming)
      next[key] = true
  }
  for (i = 0; i < state.nodes.length; i++) {
    var nk = "node/" + state.nodes[i].name
    if (nodeHealth(state.nodes[i], state.thresholds, !!prev[nk]).alarming)
      next[nk] = true
  }
  return next
}

// ---------------------------------------------------------------- flattening

// Section headers are carried on the first row of each group rather than
// existing as rows of their own, so the cursor can never land on one.
function flatten(groups) {
  var rows = []
  for (var g = 0; g < groups.length; g++) {
    var group = groups[g]
    if (!group.rows || group.rows.length === 0) continue
    for (var i = 0; i < group.rows.length; i++) {
      var row = group.rows[i]
      row.section = group.title
      row.sectionTitle = i === 0 ? group.title : ""
      row.index = rows.length
      rows.push(row)
    }
  }
  return rows
}

// ---------------------------------------------------------------- overview

function buildOverview(state) {
  var groups = []
  var i

  var containers = []
  var machines = []
  var attention = []

  for (i = 0; i < state.guests.length; i++) {
    var row = guestRow(state.guests[i], state)
    if (row.alarming) {
      // A copy, so editing the alert row's trailing text cannot also rewrite
      // the same guest's row further down the list.
      var alert = shallowCopy(row)
      alert.key = "alert/" + row.key
      alert.trailing = row.node
      attention.push(alert)
    }
    if (row.vtype === "lxc") containers.push(row)
    else machines.push(row)
  }

  var nodeRows = []
  for (i = 0; i < state.nodes.length; i++) {
    var node = nodeRow(state.nodes[i], state)
    nodeRows.push(node)
    if (node.alarming) {
      attention.push({
        kind: "guest", key: "alert/node/" + node.name, guest: null,
        vmid: 0, name: node.name, node: node.name, vtype: "node",
        glyph: glyphFor("node"), led: "crit", state: "node",
        alarming: true, reason: node.reason, console: "none",
        detail: node.reason, trailing: "node", selectable: true
      })
    }
  }

  // Absent when nothing is wrong, so its presence is the signal.
  groups.push({ title: "NEEDS ATTENTION", rows: attention })
  groups.push({ title: "NODES", rows: nodeRows })
  groups.push({ title: "CONTAINERS  ·  " + containers.length, rows: containers })
  groups.push({ title: "VIRTUAL MACHINES  ·  " + machines.length, rows: machines })

  if (state.guests.length === 0 && state.nodes.length === 0) {
    groups.push({
      title: "",
      rows: [{ kind: "note", key: "empty", name: state.emptyMessage || "No guests on this cluster", selectable: false }]
    })
  }

  return flatten(groups)
}

function shallowCopy(source) {
  var out = {}
  for (var key in source) out[key] = source[key]
  return out
}

// ---------------------------------------------------------------- guest view

// The detail view is built from the per-guest status call when it has arrived,
// and from the cluster-wide record until then. Both carry cpu/mem/disk, so the
// panel shows real figures immediately and simply gains swap, cores and
// traffic a moment later instead of opening empty.
function buildGuestView(state) {
  var guest = state.selectedGuest
  if (!guest) return flatten([{ title: "", rows: [{ kind: "note", key: "gone", name: "That guest is no longer on the cluster", selectable: false }] }])

  var key = guestKey(guest)
  var config = state.configs[key] || null
  var status = state.guestStatus && state.guestStatus.key === key ? state.guestStatus.data : null
  var detailed = status || {}
  var running = String(detailed.status || guest.status) === RUNNING

  var groups = []
  var meters = []

  var cpuFraction = Number(detailed.cpu !== undefined ? detailed.cpu : guest.cpu) || 0
  var cores = Number(detailed.cpus || guest.maxcpu) || 0
  meters.push({
    kind: "meter", key: key + "/cpu", title: "CPU",
    percent: running ? cpuFraction : 0,
    value: running ? formatPercent(cpuFraction) : "—",
    detail: cores > 0 ? cores + (cores === 1 ? " core" : " cores") : "",
    level: levelFor(cpuFraction, state.thresholds.memWarn),
    selectable: true
  })

  var mem = Number(detailed.mem !== undefined ? detailed.mem : guest.mem) || 0
  var maxmem = Number(detailed.maxmem || guest.maxmem) || 0
  var memFraction = maxmem > 0 ? mem / maxmem : 0
  // Judged on the detailed figures when they have arrived, so the guest view
  // and the list agree about whether this number means anything.
  var memReported = memoryReported({ type: guest.type, mem: mem, maxmem: maxmem })
  meters.push({
    kind: "meter", key: key + "/mem", title: "Memory",
    percent: running ? memFraction : 0,
    // Without a balloon driver the figure is the allocation, not usage. Saying
    // so is the honest reading: the guest may well be using all of it, but
    // nothing here measured that, and the number would look identical if it
    // were idle.
    value: running ? (memReported ? formatPercent(memFraction) : "allocated") : "—",
    detail: formatBytes(mem) + " / " + formatBytes(maxmem)
      + (memReported
        ? (guest.type === "qemu" && detailed.balloon ? "  ·  balloon on" : "")
        : "  ·  not measured — no balloon driver in the guest"),
    level: memReported ? levelFor(memFraction, state.thresholds.memWarn) : "ok",
    selectable: true
  })

  // Containers report swap; VMs have none to report, and an always-empty swap
  // meter on every VM would be a row that never says anything.
  if (guest.type === "lxc" && Number(detailed.maxswap) > 0) {
    var swap = Number(detailed.swap) || 0
    var maxswap = Number(detailed.maxswap) || 0
    var swapFraction = maxswap > 0 ? swap / maxswap : 0
    meters.push({
      kind: "meter", key: key + "/swap", title: "Swap",
      percent: running ? swapFraction : 0,
      value: running ? formatPercent(swapFraction) : "—",
      detail: formatBytes(swap) + " / " + formatBytes(maxswap),
      level: levelFor(swapFraction, state.thresholds.memWarn),
      selectable: true
    })
  }

  // A VM's `disk` is what the host sees allocated, which for most storage
  // types is 0 and would render as an empty bar claiming the disk is empty.
  // The container's figure is real usage, so only that one gets a meter.
  var disk = Number(detailed.disk !== undefined ? detailed.disk : guest.disk) || 0
  var maxdisk = Number(detailed.maxdisk || guest.maxdisk) || 0
  if (maxdisk > 0 && (guest.type === "lxc" || disk > 0)) {
    var diskFraction = disk / maxdisk
    meters.push({
      kind: "meter", key: key + "/disk", title: guest.type === "lxc" ? "Rootfs" : "Disk",
      percent: running || disk > 0 ? diskFraction : 0,
      value: formatPercent(diskFraction),
      detail: formatBytes(disk) + " / " + formatBytes(maxdisk),
      level: levelFor(diskFraction, state.thresholds.memWarn),
      selectable: true
    })
  } else if (maxdisk > 0) {
    meters.push({
      kind: "kv", key: key + "/disk", title: "Disk",
      value: formatBytes(maxdisk) + " allocated",
      tone: "dim", selectable: true
    })
  }

  groups.push({ title: "RESOURCES", rows: meters })

  var traffic = []
  var netin = Number(detailed.netin !== undefined ? detailed.netin : guest.netin) || 0
  var netout = Number(detailed.netout !== undefined ? detailed.netout : guest.netout) || 0
  if (netin > 0 || netout > 0) {
    traffic.push({ kind: "kv", key: key + "/net", title: "Network",
      value: "↓ " + formatBytes(netin) + "   ↑ " + formatBytes(netout), selectable: true })
  }
  var diskread = Number(detailed.diskread) || 0
  var diskwrite = Number(detailed.diskwrite) || 0
  if (diskread > 0 || diskwrite > 0) {
    traffic.push({ kind: "kv", key: key + "/io", title: "Disk I/O",
      value: "r " + formatBytes(diskread) + "   w " + formatBytes(diskwrite),
      tone: "dim", selectable: true })
  }
  groups.push({ title: "TRAFFIC  ·  SINCE BOOT", rows: traffic })

  var facts = []
  var uptime = Number(detailed.uptime !== undefined ? detailed.uptime : guest.uptime) || 0
  facts.push({ kind: "kv", key: key + "/uptime", title: "Uptime",
    value: running ? formatUptimeLong(uptime) : "not running",
    tone: running ? "normal" : "dim", selectable: true })

  if (config && config.osLabel)
    facts.push({ kind: "kv", key: key + "/os", title: "OS", value: config.osLabel, selectable: true })

  var address = state.consoleAddress || ""
  if (address !== "") {
    // Saying where the address came from is the difference between "the
    // cluster reported this" and "you told it this" — which is the first
    // thing worth knowing when the console will not connect.
    facts.push({ kind: "kv", key: key + "/addr", title: "Address",
      value: address + (state.addressPinned ? "  ·  set at the prompt" : ""),
      selectable: true })
  }

  if (guest.type === "qemu" && config) {
    facts.push({ kind: "kv", key: key + "/agent", title: "Agent",
      value: config.agent ? "enabled" : "not enabled",
      tone: config.agent ? "ok" : "dim", selectable: true })
  }
  if (guest.type === "lxc" && config) {
    facts.push({ kind: "kv", key: key + "/type", title: "Type",
      value: (config.unprivileged ? "unprivileged" : "privileged")
        + (config.features ? "  ·  " + config.features : ""),
      tone: "dim", selectable: true })
  }
  if (config) {
    facts.push({ kind: "kv", key: key + "/boot", title: "Boot",
      value: config.onboot ? "autostart" : "manual", tone: "dim", selectable: true })
  }
  facts.push({ kind: "kv", key: key + "/node", title: "Node", value: guest.node, tone: "dim", selectable: true })
  if (guest.lock)
    facts.push({ kind: "kv", key: key + "/lock", title: "Lock", value: guest.lock, tone: "warn", selectable: true })

  groups.push({ title: "GUEST", rows: facts })

  // What this panel can do to the guest's *session* — which is to say, to this
  // machine's idea of the guest. Nothing here touches the cluster.
  //
  return flatten(groups)
}

// ---------------------------------------------------------------- node view

// A node's detail is built from the cluster-wide record alone: the one call
// already carries cpu, memory, disk and uptime for every node, so nothing
// extra has to be fetched to fill this screen.
function buildNodeView(state) {
  var node = state.selectedNode
  if (!node)
    return flatten([{ title: "", rows: [{ kind: "note", key: "gone", name: "That node is no longer on the cluster", selectable: false }] }])

  var meters = []
  var cpuFraction = node.cpu
  meters.push({
    kind: "meter", key: "node/" + node.name + "/cpu", title: "CPU",
    percent: cpuFraction, value: formatPercent(cpuFraction),
    detail: (node.maxcpu > 0 ? node.maxcpu + (node.maxcpu === 1 ? " core" : " cores") : ""),
    level: levelFor(cpuFraction, state.thresholds.memWarn),
    selectable: true
  })

  var memFraction = node.maxmem > 0 ? node.mem / node.maxmem : 0
  meters.push({
    kind: "meter", key: "node/" + node.name + "/mem", title: "Memory",
    percent: memFraction, value: formatPercent(memFraction),
    detail: formatBytes(node.mem) + " / " + formatBytes(node.maxmem),
    level: levelFor(memFraction, state.thresholds.memWarn),
    selectable: true
  })

  if (node.maxdisk > 0) {
    var diskFraction = node.disk / node.maxdisk
    meters.push({
      kind: "meter", key: "node/" + node.name + "/disk", title: "Rootfs",
      percent: diskFraction, value: formatPercent(diskFraction),
      detail: formatBytes(node.disk) + " / " + formatBytes(node.maxdisk),
      level: levelFor(diskFraction, state.thresholds.memWarn),
      selectable: true
    })
  }
  // Everything below comes from the node's own status endpoint, fetched only
  // while this view is open. Each row appears only once its figure has
  // arrived, so the view is useful immediately and simply grows.
  var detailed = state.nodeStatus && state.nodeStatus.key === "node/" + node.name
    ? (state.nodeStatus.data || {}) : {}

  var swap = detailed.swap || {}
  if (Number(swap.total) > 0) {
    var swapFraction = Number(swap.used) / Number(swap.total)
    meters.push({
      kind: "meter", key: "node/" + node.name + "/swap", title: "Swap",
      percent: swapFraction, value: formatPercent(swapFraction),
      detail: formatBytes(swap.used) + " / " + formatBytes(swap.total),
      level: levelFor(swapFraction, state.thresholds.memWarn),
      selectable: true
    })
  }

  var groups = [{ title: "RESOURCES", rows: meters }]

  var load = []
  // Load average against core count is the reading that says whether a node is
  // actually oversubscribed — 4.0 is idle on 12 cores and drowning on 2.
  if (Array.isArray(detailed.loadavg) && detailed.loadavg.length >= 3) {
    load.push({ kind: "kv", key: "node/" + node.name + "/load", title: "Load",
      value: detailed.loadavg.slice(0, 3).join("  ·  ")
        + (node.maxcpu > 0 ? "   of " + node.maxcpu : ""),
      selectable: true })
  }
  // Time the CPU spent waiting on storage. A node can look idle and still be
  // unusable if this is high, and nothing else on the panel would show it.
  if (detailed.wait !== undefined) {
    var wait = Number(detailed.wait) || 0
    load.push({ kind: "kv", key: "node/" + node.name + "/wait", title: "IO delay",
      value: formatPercent(wait),
      tone: wait >= 0.1 ? "warn" : "dim", selectable: true })
  }
  if (load.length) groups.push({ title: "LOAD", rows: load })

  var facts = []
  facts.push({ kind: "kv", key: "node/" + node.name + "/uptime", title: "Uptime",
    value: formatUptimeLong(node.uptime), selectable: true })
  facts.push({ kind: "kv", key: "node/" + node.name + "/status", title: "Status",
    value: node.status, tone: node.status === "online" ? "ok" : "warn", selectable: true })

  var cpuinfo = detailed.cpuinfo || {}
  if (cpuinfo.model) {
    facts.push({ kind: "kv", key: "node/" + node.name + "/cpumodel", title: "CPU",
      value: String(cpuinfo.model).replace(/\s+/g, " ").trim(), tone: "dim", selectable: true })
  }
  if (node.maxcpu > 0) {
    facts.push({ kind: "kv", key: "node/" + node.name + "/cpus", title: "Cores",
      value: node.maxcpu + (Number(cpuinfo.sockets) > 0
        ? "  ·  " + cpuinfo.sockets + (Number(cpuinfo.sockets) === 1 ? " socket" : " sockets") : ""),
      tone: "dim", selectable: true })
  }
  if (detailed.pveversion) {
    // "pve-manager/9.2.5/20242970da7fbcef" — the trailing build hash is three
    // times the width of the part anyone reads.
    facts.push({ kind: "kv", key: "node/" + node.name + "/pve", title: "Proxmox",
      value: String(detailed.pveversion).replace(/^pve-manager\//, "").split("/")[0],
      tone: "dim", selectable: true })
  }
  // The running kernel release, not the full uname banner, which is three
  // times the width and says the same thing.
  var kernel = detailed["current-kernel"] || {}
  if (kernel.release) {
    facts.push({ kind: "kv", key: "node/" + node.name + "/kernel", title: "Kernel",
      value: String(kernel.release), tone: "dim", selectable: true })
  }
  groups.push({ title: "NODE", rows: facts })

  return flatten(groups)
}

// ---------------------------------------------------------------- search

function matchesFilter(row, filter) {
  if (!filter) return true
  var needle = String(filter).toLowerCase()
  return String(row.name || "").toLowerCase().indexOf(needle) >= 0
    || String(row.vmid || "").indexOf(needle) >= 0
    || String(row.node || "").toLowerCase().indexOf(needle) >= 0
    || String(row.detail || "").toLowerCase().indexOf(needle) >= 0
    || String(row.vtype || "").toLowerCase().indexOf(needle) >= 0
}

function buildSearch(state) {
  var matched = []
  for (var i = 0; i < state.guests.length; i++) {
    var row = guestRow(state.guests[i], state)
    if (matchesFilter(row, state.filter)) matched.push(row)
  }

  if (matched.length === 0) {
    return flatten([{
      title: "SEARCH",
      rows: [{ kind: "note", key: "no-match", name: "Nothing matches “" + state.filter + "”", selectable: false }]
    }])
  }
  return flatten([{ title: matched.length + (matched.length === 1 ? " MATCH" : " MATCHES"), rows: matched }])
}

// ---------------------------------------------------------------- entry point

function buildRows(state) {
  if (state.filter) return buildSearch(state)
  if (state.selectedGuest) return buildGuestView(state)
  if (state.selectedNode) return buildNodeView(state)
  return buildOverview(state)
}

// How many guests are running, for the bar icon's count.
function runningCount(guests) {
  var n = 0
  for (var i = 0; i < guests.length; i++) if (guests[i].status === RUNNING) n++
  return n
}

// How many things are wrong, for the bar icon's badge and the hero pill.
function alarmCount(state) {
  var n = 0
  var i
  var memo = state.alarmMemo || {}
  for (i = 0; i < state.guests.length; i++) {
    var gk = guestKey(state.guests[i])
    var config = state.configs[gk] || null
    if (guestHealth(state.guests[i], config, state.thresholds, !!memo[gk]).alarming) n++
  }
  for (i = 0; i < state.nodes.length; i++)
    if (nodeHealth(state.nodes[i], state.thresholds,
        !!memo["node/" + state.nodes[i].name]).alarming) n++
  return n
}

// "9 up · 2 down · 1 paused", skipping whatever is zero so a healthy cluster
// says "12 up" rather than padding the line with three zeroes.
function clusterSummary(guests) {
  var up = 0, down = 0, other = 0
  for (var i = 0; i < guests.length; i++) {
    var status = guests[i].status
    if (status === RUNNING) up++
    else if (status === STOPPED) down++
    else other++
  }
  var parts = []
  if (up > 0) parts.push(up + " up")
  if (down > 0) parts.push(down + " down")
  if (other > 0) parts.push(other + " paused")
  if (parts.length === 0) return "No guests"
  return parts.join("  ·  ")
}

// Section boundaries, for jumps across a long list.
function sectionStarts(rows) {
  var starts = []
  for (var i = 0; i < rows.length; i++) if (rows[i].sectionTitle !== "") starts.push(i)
  return starts
}
