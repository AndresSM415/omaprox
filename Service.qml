import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import "Api.js" as Api
import "Model.js" as Model

// Everything stateful for the Omaprox widget: credentials, the poll, the
// per-guest detail fetches, and the console launcher. The panel reads
// properties off this and never talks to the network itself.
//
// Nothing in here writes to Proxmox. Every request is a GET, and the console
// actions spawn a window rather than asking the cluster to do anything.
Item {
  id: root
  visible: false

  property var settings: ({})

  // --- credentials ---------------------------------------------------------
  //
  // The token lives in a file rather than in shell.json. shell.json is a
  // config file people paste into issues and copy between machines, and an
  // API token is not something that should travel with it.
  readonly property string credentialsPath: {
    var explicit = String(setting("credentialsPath", "") || "").trim()
    if (explicit !== "") return explicit
    var xdg = Quickshell.env("XDG_CONFIG_HOME")
    if (!xdg || xdg === "") xdg = Quickshell.env("HOME") + "/.config"
    return xdg + "/omaprox/token"
  }

  property string token: ""
  property string credentialHost: ""
  property string credentialError: ""
  property bool credentialsLoaded: false
  readonly property bool configured: token !== "" && host !== ""

  // A host in the token file wins, so a machine that talks to a different node
  // than the one in shared config needs no shell.json edit.
  readonly property string host: {
    if (credentialHost !== "") return credentialHost
    return String(setting("host", "") || "").trim()
  }

  // --- cluster -------------------------------------------------------------
  property var guests: []
  property var nodes: []
  property var configs: ({})          // guest key -> Api.readConfig result
  // Who was alarming as of the last poll. Feeds the hysteresis band; owned
  // here and updated once per poll so rows shaping stays a pure read.
  property var alarmMemo: ({})
  property var agentAddresses: ({})   // guest key -> address from the agent
  property var _configQueue: []

  // --- selection -----------------------------------------------------------
  // The guest whose detail view is open. Held here rather than in the panel so
  // the poll knows which per-guest status to keep fresh.
  property string selectedKey: ""
  property var guestStatus: ({ key: "", data: null })
  property var nodeStatus: ({ key: "", data: null })

  readonly property var selectedGuest: {
    if (selectedKey === "") return null
    for (var i = 0; i < guests.length; i++)
      if (Model.guestKey(guests[i]) === selectedKey) return guests[i]
    return null
  }

  readonly property var selectedConfig: selectedKey !== "" ? (configs[selectedKey] || null) : null

  // A node is selected through the same key channel as a guest, namespaced
  // with a "node/" prefix so the two can never collide.
  readonly property var selectedNode: {
    if (selectedKey.indexOf("node/") !== 0) return null
    var name = selectedKey.slice(5)
    for (var i = 0; i < nodes.length; i++)
      if (nodes[i].name === name) return nodes[i]
    return null
  }

  readonly property string selectedAddress: {
    var guest = selectedGuest
    if (!guest) return ""
    return Api.resolveAddress(guest, selectedConfig, agentAddresses[selectedKey] || "",
      addressOverrides, resolvedAddresses).address
  }

  // --- status --------------------------------------------------------------
  property bool refreshing: false
  property bool statusRefreshing: false
  property double lastRefreshMs: 0
  property string lastError: ""
  property string actionStatus: ""
  property bool rdpAvailable: true

  readonly property bool busy: refreshing || statusRefreshing

  // What the icons actually dim on. `busy` flips true and back on every poll,
  // and against a cluster on the same network that round trip is a few
  // milliseconds — so binding an animated opacity straight to it blinks the
  // bar icon and the hero mark on every refresh while telling you nothing you
  // did not already know. A refresh only becomes worth reporting once it is
  // slow enough that you would otherwise wonder whether the panel is stuck.
  property bool busySlow: false

  Timer {
    id: busyDelay
    interval: 700
    onTriggered: root.busySlow = root.busy
  }

  onBusyChanged: {
    if (busy) {
      busyDelay.restart()
    } else {
      busyDelay.stop()
      busySlow = false
    }
  }
  readonly property int alarms: Model.alarmCount(modelState())
  readonly property int running: Model.runningCount(guests)
  readonly property bool warning: alarms > 0 || lastError !== ""

  // --- settings ------------------------------------------------------------
  //
  // Manifest `defaults` are never merged into the injected settings by the
  // shell, so every default is restated here. Changing one means changing both.
  readonly property int refreshIntervalSec: intSetting("refreshIntervalSec", 10, 5, 300)
  readonly property real memWarn: intSetting("memWarnPercent", 90, 50, 100) / 100
  // Hysteresis: an alarming guest clears only this far below the warn line,
  // so one hovering at it cannot flip the alert section every poll.
  readonly property real memClear: Math.max(0, memWarn - Model.ALARM_CLEAR_BAND)
  readonly property bool showRunningCount: boolSetting("showRunningCount", true)
  readonly property bool showTemplates: boolSetting("showTemplates", false)
  readonly property bool smoothMeters: boolSetting("smoothMeters", true)
  readonly property bool useAgentAddresses: boolSetting("agentAddresses", false)
  readonly property bool verifyTls: boolSetting("verifyTls", false)
  readonly property string caCert: String(setting("caCert", "") || "").trim()
  readonly property string nodeSshUser: String(setting("nodeSshUser", "root") || "root")
  readonly property string guestSshUser: String(setting("guestSshUser", "root") || "root")
  // Empty means "let FreeRDP ask". There is deliberately no password setting to
  // go with it; see DEFAULT_RDP_CONSOLE_USER.
  readonly property string rdpUser: String(setting("rdpUser", "") || "").trim()
  // Not in the manifest schema, because the settings UI has no editor for a
  // map. Written by hand into shell.json as {"addresses": {"202": "10.0.20.42"}}
  // for the guests whose name is not resolvable and whose agent is off.
  readonly property var addressOverrides: {
    var value = setting("addresses", null)
    return value && typeof value === "object" ? value : ({})
  }

  // Addresses a console helper resolved by asking, rather than one written by
  // hand in shell.json. The manual override above always wins if both exist —
  // this is what fills the gap the first time a VM's address cannot be found
  // any other way, so the only manual step left is the one prompt itself.
  readonly property string addressStorePath: {
    var xdg = Quickshell.env("XDG_CONFIG_HOME")
    if (!xdg || xdg === "") xdg = Quickshell.env("HOME") + "/.config"
    return xdg + "/omaprox/addresses"
  }
  property var resolvedAddresses: ({})

  // The page a guest's web button opens, when it has one of its own. Answered
  // at the same console prompt as the address, filed under the same vmid, and
  // kept in a second file of the same `vmid = value` shape — see
  // bin/omaprox-rdp for why this is two files and not two columns.
  readonly property string webPageStorePath: {
    var xdg = Quickshell.env("XDG_CONFIG_HOME")
    if (!xdg || xdg === "") xdg = Quickshell.env("HOME") + "/.config"
    return xdg + "/omaprox/webpages"
  }
  property var webPages: ({})

  function setting(name, fallback) {
    var value = settings ? settings[name] : undefined
    return value === undefined || value === null ? fallback : value
  }

  function intSetting(name, fallback, min, max) {
    var n = parseInt(String(setting(name, fallback)), 10)
    if (!isFinite(n)) n = fallback
    return Math.max(min, Math.min(max, n))
  }

  // The manifest schema has no boolean type, so on/off settings arrive as the
  // enum strings the settings UI writes.
  function boolSetting(name, fallback) {
    var value = setting(name, fallback ? "On" : "Off")
    if (typeof value === "boolean") return value
    var text = String(value).toLowerCase()
    return text === "on" || text === "true" || text === "yes" || text === "1"
  }

  // Snapshot handed to Model.buildRows. A function rather than a property so
  // the panel controls when the list is rebuilt.
  function modelState() {
    return {
      guests: guests, nodes: nodes, configs: configs,
      selectedGuest: selectedGuest,
      selectedNode: selectedNode,
      guestStatus: guestStatus,
      nodeStatus: nodeStatus,
      consoleAddress: selectedAddress,
      // Whether the address on screen is one someone typed at the prompt or
      // one the cluster reported. The difference is the first thing worth
      // knowing when the console will not connect.
      addressPinned: selectedGuest
        ? !!resolvedAddresses[String(selectedGuest.vmid)] : false,
      thresholds: { memWarn: memWarn, memClear: memClear },
      alarmMemo: alarmMemo,
      showTemplates: showTemplates,
      filter: "",
      emptyMessage: configured ? "No guests on this cluster" : ""
    }
  }

  // ------------------------------------------------------------- credentials

  // Quickshell's FileView watches the file *and its parent directory* so it
  // notices the file being created, not just edited — but QFileSystemWatcher's
  // addPath() fails silently on a directory that does not exist yet, with no
  // signal ever fired. A widget enabled before `~/.config/omaprox/` exists
  // watches nothing, forever, no matter what gets written into it later — only
  // a full shell restart rebuilds the watcher and notices. Creating the
  // directory before the FileView below is constructed is what makes the
  // watcher have something to attach to in the first place.
  Process {
    id: ensureCredentialDir
    running: true
    command: ["mkdir", "-p", root.credentialsPath.slice(0, root.credentialsPath.lastIndexOf("/"))]
  }

  FileView {
    id: credentialFile
    path: root.credentialsPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.applyCredentials(text())
    onLoadFailed: {
      root.credentialsLoaded = true
      root.token = ""
      // The host has to go too. It came out of the file that just stopped
      // existing, and leaving it behind made the setup panel report a host it
      // could no longer justify — with a tick next to it.
      root.credentialHost = ""
      root.credentialError = "no token file at " + root.credentialsPath
    }
  }

  // Same watcher-on-a-missing-directory hazard as the token file above, and
  // the same fix: create the directory before the FileView below is built.
  Process {
    id: ensureAddressStoreDir
    running: true
    command: ["mkdir", "-p", root.addressStorePath.slice(0, root.addressStorePath.lastIndexOf("/"))]
  }

  FileView {
    id: addressStoreFile
    path: root.addressStorePath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.resolvedAddresses = Api.parseAddressStore(text())
    // Absence is the normal state until the first console helper writes to
    // it — nothing to report, just nothing stored yet.
    onLoadFailed: root.resolvedAddresses = ({})
  }

  // Same file shape, same parser, same "absence is normal" — a URL is a value
  // keyed by vmid exactly as an address is.
  FileView {
    id: webPageStoreFile
    path: root.webPageStorePath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.webPages = Api.parseAddressStore(text())
    onLoadFailed: root.webPages = ({})
  }

  // Belt and suspenders for the watcher gap above: even with the directory
  // pre-created, a token file written by an editor that saves via a temporary
  // file and renames it over the original can still slip past inotify. Retried
  // reload is cheap — one stat of a file a few hundred bytes long — and stops
  // itself the moment a token is actually loaded.
  Timer {
    interval: 4000
    repeat: true
    running: root.credentialsLoaded && root.token === ""
    onTriggered: credentialFile.reload()
  }

  function applyCredentials(text) {
    var parsed = Api.parseCredentials(text)
    var changed = parsed.token !== root.token
    root.credentialsLoaded = true
    root.token = parsed.token
    root.credentialHost = parsed.host
    root.credentialError = parsed.error !== "" ? parsed.error
      : (parsed.token === "" ? "no token found in " + root.credentialsPath : "")
    if (root.credentialError === "" && root.lastError.indexOf("token") >= 0) root.lastError = ""
    // The watcher is the only thing that knows a usable token has arrived, so
    // it owns restarting the work that was waiting on one.
    if (changed && parsed.token !== "") Qt.callLater(function() { root.refresh() })
  }

  // ------------------------------------------------------------- fetching

  // One reusable request slot per concurrent fetch. Each writes its curl config
  // to stdin, then drops stdin so curl sees EOF and proceeds; `stdinEnabled` is
  // re-armed before the next start because the channel state is read fresh when
  // the QProcess is created.
  component Request: Process {
    id: req
    property var handler: null
    property string configText: ""

    stdinEnabled: true
    stdout: StdioCollector { id: out; waitForEnd: true }
    stderr: StdioCollector { id: err; waitForEnd: true }

    function send(url, onDone) {
      if (req.running) return false
      req.handler = onDone
      req.configText = Api.curlConfig(root.token, url, {
        verifyTls: root.verifyTls,
        caCert: root.caCert
      })
      req.command = Api.curlGet()
      req.stdinEnabled = true
      req.running = true
      return true
    }

    onStarted: {
      write(configText)
      configText = ""
      // EOF, so `curl -K -` stops waiting for more config.
      stdinEnabled = false
    }

    onExited: function(exitCode) {
      var handler = req.handler
      req.handler = null
      if (handler) handler(exitCode, String(out.text || ""), String(err.text || "").trim())
    }
  }

  Request { id: clusterReq }
  Request { id: statusReq }
  Request { id: configReq }
  Request { id: agentReq }

  // Uniform completion handling. `label` names the endpoint in any error the
  // panel surfaces; `assign` receives the unwrapped `data`.
  function handle(label, assign, onFail) {
    return function(exitCode, text, errorText) {
      if (exitCode !== 0) {
        // curl's own exit codes say more about a homelab misconfiguration than
        // its stderr does — the wrong port and a bad certificate both produce
        // walls of text that bury which one it was.
        root.lastError = label + ": " + root.curlFailure(exitCode, errorText)
        if (onFail) onFail()
        return
      }
      var response = Api.parseResponse(text)
      if (!response.ok) {
        root.lastError = label + ": " + response.error
        // A rejected token means the guests and nodes on screen belong to
        // whatever the token last worked against, which is no longer
        // provably this host — pointing the same address at a different
        // install (a rebuilt node, a restored one, one entered by hand while
        // testing) leaves the old cluster's data on screen looking exactly
        // as current as it did a moment ago. Any other failure — the network
        // down for one poll, a timeout — leaves the list alone: the data is
        // just old, not wrong, and clearing it on every blip would empty the
        // panel over a single flaky refresh.
        if (response.auth) root.clearClusterData()
        if (onFail) onFail()
        return
      }
      root.lastError = ""
      assign(response.data)
    }
  }

  function curlFailure(exitCode, errorText) {
    switch (exitCode) {
    case 6: return "cannot resolve " + Api.normalizeHost(root.host)
    case 7: return "cannot connect to " + Api.normalizeHost(root.host)
    case 28: return "timed out talking to " + Api.normalizeHost(root.host)
    case 35:
    case 60: return "TLS rejected — Proxmox self-signs, so leave certificate verification Off or point caCert at your CA"
    }
    return errorText !== "" ? errorText : "curl exited " + exitCode
  }

  // Everything the last successful poll produced. Called only when a token is
  // rejected outright — see `handle()` — because that is the one failure that
  // means the data is not merely old but no longer known to belong to this
  // host at all.
  function clearClusterData() {
    root.guests = []
    root.nodes = []
    root.configs = ({})
    root.agentAddresses = ({})
    root._configQueue = []
    root.alarmMemo = ({})
  }

  function refresh() {
    if (!credentialsLoaded || token === "" || host === "") return
    if (clusterReq.running) return

    root.refreshing = true
    clusterReq.send(Api.clusterResourcesUrl(host), handle("cluster", function(data) {
      var split = Model.splitResources(data, { showTemplates: root.showTemplates })
      root.nodes = split.nodes
      root.guests = split.guests
      // Recompute who is alarming against fresh figures, honouring the clear
      // band for guests flagged last round. Done here rather than during row
      // shaping, so the memo never reads and writes inside one binding pass.
      root.alarmMemo = Model.updateAlarmMemo(root.modelState())
      root.refreshing = false
      root.lastRefreshMs = Date.now()
      root.queueConfigs()
      // The open guest's or node's numbers come from its own endpoint, and
      // the cluster poll is the clock everything else runs on, so it drives
      // that too.
      if (root.selectedKey !== "") root.refreshSelectedStatus()
    }, function() { root.refreshing = false }))
  }

  // ------------------------------------------------------- per-guest config

  // A guest's config carries its OS, its autostart flag and (for containers)
  // its address. None of it changes minute to minute, so it is fetched once per
  // guest and cached for the session. The queue drains one at a time so a
  // forty-guest cluster does not open forty sockets on the first poll.
  function queueConfigs() {
    var pending = []
    for (var i = 0; i < guests.length; i++) {
      var key = Model.guestKey(guests[i])
      if (configs[key] !== undefined) continue
      pending.push(guests[i])
    }
    root._configQueue = pending
    root.drainConfigQueue()
  }

  function drainConfigQueue() {
    if (configReq.running) return
    if (!root._configQueue || root._configQueue.length === 0) return
    var queue = root._configQueue.slice()
    var guest = queue.shift()
    root._configQueue = queue
    var key = Model.guestKey(guest)

    configReq.send(Api.guestConfigUrl(host, guest.node, guest.type, guest.vmid),
      function(exitCode, text) {
        var parsed = null
        if (exitCode === 0) {
          var response = Api.parseResponse(text)
          if (response.ok) parsed = Api.readConfig(guest.type, response.data)
        }
        // Cache the miss too. A guest whose config cannot be read — no
        // permission, since deleted — would otherwise be re-requested on every
        // poll forever.
        var next = {}
        for (var existing in root.configs) next[existing] = root.configs[existing]
        next[key] = parsed || Api.readConfig(guest.type, {})
        root.configs = next

        if (parsed && parsed.agent && root.useAgentAddresses && !parsed.address)
          root.fetchAgentAddress(guest)

        Qt.callLater(function() { root.drainConfigQueue() })
      })
  }

  // The one call that needs VM.Monitor rather than VM.Audit, so it only runs
  // when the setting is on. A failure is silent: the console falls back to the
  // guest's name, which is what it would have used anyway.
  function fetchAgentAddress(guest) {
    if (agentReq.running) return
    var key = Model.guestKey(guest)
    agentReq.send(Api.agentInterfacesUrl(host, guest.node, guest.vmid), function(exitCode, text) {
      if (exitCode !== 0) return
      var response = Api.parseResponse(text)
      if (!response.ok) return
      var address = Api.readAgentAddress(response.data)
      if (address === "") return
      var next = {}
      for (var existing in root.agentAddresses) next[existing] = root.agentAddresses[existing]
      next[key] = address
      root.agentAddresses = next
    })
  }

  // ------------------------------------------------------- per-guest status

  function selectGuest(key) {
    if (root.selectedKey === key) return
    root.selectedKey = String(key || "")
    // Drop the old guest's numbers immediately. Showing the previous guest's
    // memory under the new guest's name for one poll is worse than showing the
    // cluster-wide figures the detail view falls back to.
    root.guestStatus = { key: "", data: null }
    root.nodeStatus = { key: "", data: null }
    if (root.selectedKey !== "") root.refreshSelectedStatus()
  }

  // Whichever of the two is open. Only one can be selected at a time, so they
  // share the single request slot.
  function refreshSelectedStatus() {
    if (selectedNode) refreshNodeStatus()
    else refreshGuestStatus()
  }

  function refreshNodeStatus() {
    var node = selectedNode
    if (!node) return
    if (statusReq.running) return
    if (token === "" || host === "") return

    var key = root.selectedKey
    root.statusRefreshing = true
    statusReq.send(Api.nodeStatusUrl(host, node.name),
      function(exitCode, text, errorText) {
        root.statusRefreshing = false
        if (exitCode !== 0) {
          root.lastError = "node status: " + root.curlFailure(exitCode, errorText)
          return
        }
        var response = Api.parseResponse(text)
        if (!response.ok) {
          // Not fatal: the node view still has everything the cluster call
          // gave it, and simply shows fewer rows.
          root.lastError = "node status: " + response.error
          return
        }
        if (key !== root.selectedKey) return
        root.lastError = ""
        root.nodeStatus = { key: key, data: response.data }
      })
  }

  function refreshGuestStatus() {
    var guest = selectedGuest
    if (!guest) return
    if (statusReq.running) return
    if (token === "" || host === "") return

    var key = Model.guestKey(guest)
    root.statusRefreshing = true
    statusReq.send(Api.guestStatusUrl(host, guest.node, guest.type, guest.vmid),
      function(exitCode, text, errorText) {
        root.statusRefreshing = false
        if (exitCode !== 0) {
          root.lastError = "status: " + root.curlFailure(exitCode, errorText)
          return
        }
        var response = Api.parseResponse(text)
        if (!response.ok) {
          root.lastError = "status: " + response.error
          return
        }
        // The panel may have moved on while this was in flight; attributing
        // one guest's figures to another is the one wrong thing a read-only
        // dashboard can still do.
        if (key !== root.selectedKey) return
        root.lastError = ""
        root.guestStatus = { key: key, data: response.data }
      })
  }

  // ------------------------------------------------------------- console

  // The only thing in the plugin that acts, and it acts on this machine: it
  // opens a window. Proxmox is not asked to do anything.
  function nodeByName(name) {
    for (var i = 0; i < nodes.length; i++)
      if (nodes[i].name === name) return nodes[i]
    return null
  }

  // A shell on the node itself. Same helper as a guest console, so the
  // one-time SSH key offer covers this too.
  function openNodeConsole(node) {
    if (!node) return
    // On a cluster the node has to be addressed by its own name; on a single
    // node the API host is the same machine and is known to resolve, which a
    // name like `pve` frequently does not.
    var target = nodes.length > 1 ? node.name : Api.hostAuthority(host)
    runInTerminal(
      Util.shellQuote(helperPath("omaprox-ssh")) + " "
        + Util.shellQuote(nodeSshUser) + " " + Util.shellQuote(target),
      node.name + "  ·  node")
    flashStatus("Console: " + node.name)
  }

  function openConsole(guest) {
    if (!guest) return
    if (guest.status !== "running") {
      flashStatus(guest.name + " is not running")
      return
    }

    var key = Model.guestKey(guest)
    var config = configs[key] || null
    var resolved = Api.resolveAddress(guest, config, agentAddresses[key] || "",
      addressOverrides, resolvedAddresses)
    var address = resolved.address
    var values = {
      vmid: guest.vmid, name: guest.name, node: guest.node, address: address,
      // The bare address the API is reached on, for setups whose node names do
      // not resolve. Correct for a single node; on a cluster it is whichever
      // node you pointed the plugin at, which is why the default still uses
      // {node}.
      host: Api.hostAuthority(host),
      nodeUser: nodeSshUser, guestUser: guestSshUser, rdpUser: rdpUser
    }

    // The window title names the guest, so a screen full of consoles is
    // tellable apart at a glance and in the window switcher.
    var title = guest.name + "  ·  " + (guest.type === "lxc" ? "LXC " : "VM ") + guest.vmid

    if (guest.type === "lxc") {
      var lxcTemplate = String(setting("lxcConsoleCommand", "") || "").trim()
      var lxcCommand
      if (lxcTemplate !== "") {
        lxcCommand = Api.renderCommand(lxcTemplate, values)
      } else {
        // `pct enter` has to run on the node the container is on, so a cluster
        // must address the node by name and needs those names to resolve. A
        // single-node setup has no such constraint and the API host is known to
        // be reachable — which matters because a node name like `pve` usually
        // resolves to nothing at all.
        var lxcHost = nodes.length > 1 ? guest.node : Api.hostAuthority(host)
        // --vmid/--guess carry the container's own identity even though the
        // connection targets its node: the helper needs them to ask for, and
        // file, a web page against the container rather than against the node
        // every container on it shares.
        lxcCommand = Util.shellQuote(helperPath("omaprox-ssh"))
          + " --vmid " + Util.shellQuote(String(guest.vmid))
          + " --guess " + Util.shellQuote(guest.name)
          + " --"
          + " " + Util.shellQuote(nodeSshUser)
          + " " + Util.shellQuote(lxcHost)
          + " pct enter " + Util.shellQuote(String(guest.vmid))
      }
      runInTerminal(lxcCommand, title)
      flashStatus("Console: " + guest.name)
      return
    }

    if (config && config.windows) {
      if (!rdpAvailable) {
        flashStatus("xfreerdp3 is not installed — install freerdp to open Windows guests")
        return
      }
      var rdpTemplate = String(setting("rdpCommand", "") || "").trim()
      if (rdpTemplate === "") {
        // Straight to the helper with no terminal wrapped around it. When it
        // already has the address and credentials nothing appears but the
        // desktop; when it does not have either, it opens its own terminal to
        // ask — address first, then credentials if those are also unknown —
        // and closes it again once the session starts. Wrapping it here would
        // put a terminal on screen every time, including the times it has
        // nothing to say.
        //
        // An unconfirmed address is handed over as an empty string rather than
        // the guessed guest name: that guess is exactly what used to be tried
        // silently and fail, and passing it through would give the helper no
        // way to tell a real address from a hopeful one.
        // "--" closes the option list. Without it an address the cluster
        // supplied that merely looks like a flag is parsed as one, and the
        // helper takes its vmid from the argument after it.
        Quickshell.execDetached([
          helperPath("omaprox-rdp"), "--vmid", String(guest.vmid), "--",
          resolved.known ? address : "", guest.name
        ].concat(rdpUser !== "" ? ["/u:" + rdpUser] : []))
        flashStatus(resolved.known ? "RDP: " + address : "RDP: " + guest.name + " — resolving address")
        return
      }

      // A hand-written rdpCommand runs in a terminal, because whatever it does
      // about credentials it will need somewhere to ask — that was the bug that
      // made a detached xfreerdp look like a button that did nothing.
      runInTerminal(Api.renderCommand(rdpTemplate, values), title)
      flashStatus("RDP: " + address)
      return
    }

    var vmTemplate = String(setting("vmConsoleCommand", "") || "").trim()
    var vmCommand = vmTemplate !== ""
      ? Api.renderCommand(vmTemplate, values)
      // This one runs in a terminal already (unlike the RDP path above), so
      // there is no no-tty relaunch to arrange — an unresolved address is
      // simply asked for inline, the same terminal the console itself opens
      // in.
      : Util.shellQuote(helperPath("omaprox-ssh"))
        + " --vmid " + Util.shellQuote(String(guest.vmid))
        + " --guess " + Util.shellQuote(guest.name)
        + " --"
        + " " + Util.shellQuote(guestSshUser)
        + " " + Util.shellQuote(resolved.known ? address : "")
    runInTerminal(vmCommand, title)
    flashStatus("Console: " + guest.name)
  }

  // "Restore the prompts": drop whatever a console helper resolved or saved
  // for this guest, so the next connection asks from scratch instead of
  // reusing an address or password that turned out to be wrong. Only QEMU
  // guests have anything to forget — a container's console always targets
  // its node, never the guest itself, so there is no per-guest address or
  // credential riding on it.
  function forgetCredentials(guest) {
    if (!guest) return
    if (forgetReq.running) return
    var key = Model.guestKey(guest)
    var config = configs[key] || null
    var resolved = Api.resolveAddress(guest, config, agentAddresses[key] || "",
      addressOverrides, resolvedAddresses)
    // The address is handed over only for a VM, and only when something
    // actually resolved one. It is the key the keyring entry is filed under: a
    // container has no saved password to clear, and an unresolved address is
    // the guest's own *name*, so passing it would aim `secret-tool clear` at
    // whatever else on the network answers to that name.
    forgetReq.command = guest.type === "qemu" && resolved.known
      ? [helperPath("omaprox-forget"), String(guest.vmid), resolved.address]
      : [helperPath("omaprox-forget"), String(guest.vmid)]
    forgetReq.running = true
  }

  // No status line on the way out. The guest view already shows the result in
  // the rows themselves — the address falls back to the guest's name, the web
  // page falls back to the Proxmox one — and a banner announcing what is
  // visible two lines below it is a second copy of the same news. The stores
  // are watched, so those rows update on their own.
  Process { id: forgetReq }

  // Scripts ship next to the QML, so the plugin stays a self-contained checkout
  // with nothing installed onto PATH.
  function helperPath(name) {
    return Qt.resolvedUrl("bin/" + name).toString().replace(/^file:\/\//, "")
  }

  // A visible floating terminal rather than a background process: you get the
  // real output, the host-key and password prompts, and somewhere to hit
  // Ctrl-C.
  //
  // Deliberately not omarchy-launch-floating-terminal-with-presentation. That
  // wrapper paints the Omarchy logo over the top of the window and a "press any
  // key" banner at the end, which is branding on a window whose whole job is to
  // tell you about one guest. The app-id is kept because that is what Omarchy's
  // window rules float on; the title carries the guest's name instead, so a
  // stack of consoles is tellable apart.
  //
  // The window is held open only when the command fails. On success it closes
  // with the session, and on failure the error stays on screen instead of
  // flashing past.
  function runInTerminal(command, title) {
    var script = String(command)
      + '; __rc=$?; if [ $__rc -ne 0 ]; then printf "\\n[exited %s] press enter to close" "$__rc"; read -r _; fi'
    Quickshell.execDetached([
      "setsid", "uwsm-app", "--", "xdg-terminal-exec",
      "--app-id=org.omarchy.terminal",
      "--title=" + String(title || "proxmox"),
      "-e", "bash", "-c", script
    ])
  }

  // Checked once at startup so a missing freerdp is reported when the button
  // is pressed rather than by nothing happening at all.
  Process {
    id: rdpProbe
    command: ["bash", "-lc", "command -v xfreerdp3 >/dev/null 2>&1 || command -v xfreerdp >/dev/null 2>&1"]
    running: true
    onExited: function(exitCode) { root.rdpAvailable = exitCode === 0 }
  }

  // Where a guest's web button goes: the page answered at the console prompt
  // if it has one, and its page in the Proxmox UI otherwise.
  function guestWebUrl(guest) {
    if (!guest) return ""
    return Api.guestWebUrl(host, guest, webPages[String(guest.vmid)] || "")
  }

  function hasCustomWebPage(guest) {
    if (!guest) return false
    return Api.normalizeWebUrl(webPages[String(guest.vmid)] || "") !== ""
  }

  function openWebUi(guest) {
    if (!guest) return
    var url = guestWebUrl(guest)
    if (url === "") return
    openUrl(url)
  }

  function openNodeWebUi(node) {
    if (!node || host === "") return
    openUrl(Api.webUiNodeUrl(host, node))
  }

  function openUrl(url) {
    if (!url) return
    Quickshell.execDetached(["omarchy-launch-browser", String(url)])
  }

  function copyToClipboard(value, label) {
    var text = String(value || "")
    if (text === "") return
    clipboard.payload = text
    clipboard.stdinEnabled = true
    clipboard.running = true
    flashStatus("Copied " + (label || "value"))
  }

  Process {
    id: clipboard
    property string payload: ""
    command: ["wl-copy"]
    stdinEnabled: true
    onStarted: {
      write(payload)
      payload = ""
      stdinEnabled = false
    }
  }

  function flashStatus(text) {
    root.actionStatus = String(text || "")
    statusTimer.restart()
  }

  Timer {
    id: statusTimer
    interval: 2600
    onTriggered: root.actionStatus = ""
  }

  // ------------------------------------------------------------- scheduling

  Timer {
    id: pollTimer
    interval: root.refreshIntervalSec * 1000
    repeat: true
    running: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  // A hung curl would otherwise wedge its slot forever, since every poll is
  // skipped while its own request is still running. curl's --max-time is the
  // first line of defence; this is the backstop for a process that never
  // reports at all.
  Timer {
    id: watchdog
    interval: 30000
    repeat: true
    running: root.refreshing || root.statusRefreshing
    onTriggered: {
      var slots = [clusterReq, statusReq, configReq, agentReq]
      for (var i = 0; i < slots.length; i++) if (slots[i].running) slots[i].running = false
      root.refreshing = false
      root.statusRefreshing = false
      root.lastError = "request timed out"
    }
  }
}
