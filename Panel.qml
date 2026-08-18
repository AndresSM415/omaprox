import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Api.js" as Api
import "Model.js" as Model

Panel {
  id: root
  moduleName: "io.github.andressm415.omaprox"
  ipcTarget: "io.github.andressm415.omaprox"
  manageIpc: false

  // --- theme ---------------------------------------------------------------
  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property color faint: Qt.darker(foreground, 2.2)
  readonly property color track: Util.alpha(foreground, 0.14)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color hoverFill: bar ? Style.hoverFillFor(bar.foreground, Color.accent) : "transparent"
  readonly property color selectedFill: bar ? Style.selectedFillFor(bar.foreground, Color.accent) : "transparent"
  readonly property color barIconColor: pve.configured ? barForeground : Qt.darker(barForeground, 1.55)

  // Status is carried by brightness and fill, not by hue. Omarchy themes are
  // frequently monochrome — the default palette has foreground and accent set
  // to the same grey — so a green "running" dot would be invented colour that
  // belongs to no theme. `urgent` is the one semantic colour every theme
  // defines, so it is the only one used, and only for things that are wrong.
  // Every non-running row also prints its state as text, so the LED is a scan
  // aid rather than the only channel.
  function ledColor(led) {
    if (led === "crit") return urgent
    if (led === "run") return foreground
    return dim
  }

  // --- cursor --------------------------------------------------------------
  // One flat index over one ListView. The panel body is heterogeneous, but
  // every row is a row, so navigation does not need to know which section it
  // is in.
  property bool cursorActive: false
  property int cursorIndex: 0
  property string filter: ""
  property bool filtering: false

  // Where the cursor was in the overview, restored on the way back out. Coming
  // back from a guest to find the cursor reset to the top is the small thing
  // that makes a drill-down feel like a maze.
  property int overviewCursor: 0

  readonly property bool inGuest: pve.selectedKey !== "" && filter === ""
  readonly property bool inNode: pve.selectedNode !== null && filter === ""

  // The last width each meter drew, keyed by the row's stable key, so a meter
  // rebuilt on the next poll can glide from where it was instead of sweeping
  // up from zero.
  property var meterValues: ({})

  readonly property var rows: {
    if (!pve.credentialsLoaded) return []
    if (!pve.configured) return setupRows()
    var state = pve.modelState()
    state.filter = root.filter
    // Search reaches every guest from anywhere, including from inside one.
    if (root.filter !== "") state.selectedGuest = null
    return Model.buildRows(state)
  }

  readonly property var currentRow: rows.length > 0 && cursorIndex >= 0 && cursorIndex < rows.length
    ? rows[cursorIndex] : null

  // Rows that are actually results, as opposed to the "nothing matches" note
  // that occupies a row without being one. Counting raw rows made an empty
  // search report "1 matching" directly above the line saying it matched
  // nothing.
  readonly property int matchCount: {
    var n = 0
    for (var i = 0; i < rows.length; i++) if (rows[i].kind !== "note") n++
    return n
  }

  // The guest the console and web-UI actions apply to: whichever one the
  // cursor is on in a list, or the open one in the detail view.
  readonly property var actionGuest: {
    if (currentRow && currentRow.kind === "guest" && currentRow.guest) return currentRow.guest
    if (inGuest) return pve.selectedGuest
    return null
  }

  // What is missing, in the order you have to fix it. A panel that says
  // "not configured" and stops is a panel you have to go read a README for.
  function setupRows() {
    var steps = []
    var hasHost = pve.host !== ""
    var hasToken = pve.token !== ""

    steps.push({
      kind: "note", key: "setup-host", selectable: false,
      name: hasHost ? "✓  Host: " + Api.normalizeHost(pve.host)
        : "1.  Set \"host\" for this widget in shell.json, e.g. \"pve01.lan\""
    })
    steps.push({
      kind: "note", key: "setup-token", selectable: false,
      name: hasToken ? "✓  Token loaded from " + pve.credentialsPath
        : "2.  Put a token in " + pve.credentialsPath
    })
    if (!hasToken)
      steps.push({ kind: "note", key: "setup-example", selectable: false,
        name: "user@pam!omarchy=00000000-0000-0000-0000-000000000000" })
    // Only when it is something other than the plain absence already stated by
    // step 2 — repeating "there is no file" under "put a file here" is noise.
    if (pve.credentialError !== "" && hasToken)
      steps.push({ kind: "note", key: "setup-error", selectable: false, name: pve.credentialError })
    steps.push({
      kind: "note", key: "setup-perms", selectable: false,
      name: "The token needs only VM.Audit, Sys.Audit and Datastore.Audit — the stock PVEAuditor role. A token that cannot stop a guest cannot stop one by accident."
    })
    // Selectable on purpose: Enter or a click opens the full guide, so the
    // panel can stay the short version of the instructions.
    steps.push({
      kind: "note", key: "setup-readme",
      name: "Full setup guide in the README — github.com/AndresSM415/omaprox",
      link: "https://github.com/AndresSM415/omaprox"
    })

    var rows = []
    for (var i = 0; i < steps.length; i++) {
      steps[i].section = "SETUP"
      steps[i].sectionTitle = i === 0 ? "SETUP" : ""
      steps[i].index = i
      rows.push(steps[i])
    }
    return rows
  }

  // The hero doubles as the breadcrumb: inside a guest it names the guest and
  // says how to get back, so the drill-down never leaves you unsure where you
  // are or how to leave.
  readonly property string heroTitle: {
    if (filtering || filter !== "") return "Search"
    if (!pve.configured) return "Omaprox"
    var node = pve.selectedNode
    if (inNode && node) return node.name
    var guest = pve.selectedGuest
    if (inGuest && guest) return guest.name
    var label = Api.hostLabel(pve.host)
    return label !== "" ? label : "Proxmox"
  }

  readonly property string heroMeta: {
    if (!pve.credentialsLoaded) return "Reading the token file"
    if (!pve.configured) return "Not configured yet"
    if (filtering || filter !== "")
      return (matchCount === 0 ? "no matches" : matchCount + " matching")
        + "  ·  esc to leave search"
    var node = pve.selectedNode
    if (inNode && node)
      return "node  ·  " + String(node.status || "unknown") + "  ·  h to go back"
    var guest = pve.selectedGuest
    if (inGuest && guest) {
      return (guest.type === "lxc" ? "LXC " : "QEMU ") + guest.vmid
        + "  ·  " + guest.node + "  ·  h to go back"
    }
    if (pve.lastError !== "") return pve.lastError
    if (pve.guests.length === 0 && pve.refreshing) return "Reading the cluster"
    return Model.clusterSummary(pve.guests)
      + (pve.nodes.length > 1 ? "  ·  " + pve.nodes.length + " nodes" : "")
  }

  readonly property string heroDetail: {
    if (!pve.configured) return "SETUP"
    var node = pve.selectedNode
    if (inNode && node) return String(node.status || "").toUpperCase()
    var guest = pve.selectedGuest
    if (inGuest && guest && filter === "") return String(guest.status || "").toUpperCase()
    if (pve.alarms > 0) return pve.alarms + (pve.alarms === 1 ? " ALERT" : " ALERTS")
    return ""
  }

  // ------------------------------------------------------------- navigation

  function selectableAt(index) {
    if (index < 0 || index >= rows.length) return false
    return rows[index].selectable !== false
  }

  function clampCursor() {
    if (rows.length === 0) { cursorIndex = 0; return }
    if (cursorIndex >= rows.length) cursorIndex = rows.length - 1
    if (cursorIndex < 0) cursorIndex = 0
    if (!selectableAt(cursorIndex)) {
      for (var i = cursorIndex; i < rows.length; i++) if (selectableAt(i)) { cursorIndex = i; return }
      for (var j = cursorIndex; j >= 0; j--) if (selectableAt(j)) { cursorIndex = j; return }
    }
  }

  function moveCursor(dx, dy) {
    cursorActive = true
    if (dy !== 0 && rows.length > 0) {
      var next = cursorIndex
      do {
        next += (dy > 0 ? 1 : -1)
      } while (next >= 0 && next < rows.length && !selectableAt(next))
      if (next >= 0 && next < rows.length) cursorIndex = next
    }
    // Left and right are the drill-down axis, the way they are in a file
    // manager: right goes in, left comes back out.
    if (dx > 0) enterCurrent()
    else if (dx < 0) goBack()
    clampCursor()
  }

  function enterCurrent() {
    var row = currentRow
    if (!row) return false
    if (row.kind === "guest" && row.guest) {
      if (!inGuest) overviewCursor = cursorIndex
      pve.selectGuest(row.key.indexOf("alert/") === 0 ? row.key.slice(6) : row.key)
      finishDrill()
      return true
    }
    if (row.kind === "node" || (row.kind === "guest" && row.vtype === "node")) {
      enterNode(row.kind === "node" ? row.name : row.node)
      return true
    }
    return false
  }

  function enterNode(name) {
    if (!name) return
    if (!inGuest && !inNode) overviewCursor = cursorIndex
    pve.selectGuest("node/" + name)
    finishDrill()
  }

  // Entering a guest or node from the list, or from search. The search field
  // keeps its own text and focus independently of the filter, so both have to
  // be dropped here or the next keystroke resumes filtering.
  function finishDrill() {
    filter = ""
    filtering = false
    filterField.text = ""
    cursorIndex = 0
    cursorActive = true
    keyCatcher.forceActiveFocus()
  }

  function goBack() {
    if (filter !== "" || filtering) { leaveSearch(); return true }
    if (!inGuest && !inNode) return false
    pve.selectGuest("")
    cursorIndex = overviewCursor
    clampCursor()
    return true
  }

  function leaveSearch() {
    filtering = false
    filter = ""
    filterField.text = ""
    cursorIndex = inGuest || inNode ? 0 : overviewCursor
    clampCursor()
    keyCatcher.forceActiveFocus()
  }

  function setCursor(index) {
    cursorActive = true
    cursorIndex = index
    clampCursor()
  }

  // Enter drills into a guest from a list, and opens the web UI once you are
  // already looking at one — at which point "in" has nowhere left to go and
  // the Proxmox UI is the thing you actually wanted.
  function activateCursor() {
    var row = currentRow
    if (!row) return
    if (row.kind === "note") {
      if (row.link) pve.openUrl(row.link)
      return
    }
    // From the list, Enter drills into a guest or a node; once inside, it has
    // nowhere left to go and opens the web UI instead.
    if (!inGuest && !inNode && (row.kind === "guest" || row.kind === "node")) {
      enterCurrent()
      return
    }
    openWebUi()
  }

  function openWebUi() {
    var guest = actionGuest
    if (guest) { pve.openWebUi(guest); close(); return }
    var node = pve.selectedNode
    if (node) { pve.openNodeWebUi(node.name); close(); return }
    var row = currentRow
    if (row && (row.kind === "node" || row.vtype === "node")) {
      pve.openNodeWebUi(row.name || row.node)
      close()
      return
    }
    if (pve.host !== "") { pve.openUrl(Api.normalizeHost(pve.host)); close() }
  }

  function openConsole() {
    var guest = actionGuest
    if (guest) { pve.openConsole(guest); close(); return }
    // A node row in the list, or the node whose detail view is open.
    var row = currentRow
    var node = pve.selectedNode
      || (row && row.kind === "node" ? pve.nodeByName(row.name) : null)
      || (row && row.vtype === "node" ? pve.nodeByName(row.node) : null)
    if (node) { pve.openNodeConsole(node); close(); return }
    pve.flashStatus("Nothing selected")
  }

  // The address is the thing you actually paste somewhere else; the vmid is
  // only ever useful inside Proxmox, where you already are.
  function copyCurrent() {
    var row = currentRow
    if (!row) return
    var node = pve.selectedNode
    if (node && !actionGuest) {
      pve.copyToClipboard(node.name, "node name")
      return
    }
    if (row.kind === "node" || row.vtype === "node") {
      pve.copyToClipboard(row.name || row.node, "node name")
      return
    }
    var guest = actionGuest
    if (!guest) return
    var key = Model.guestKey(guest)
    var address = Api.consoleAddress(guest, pve.configs[key] || null,
      pve.agentAddresses[key] || "", pve.addressOverrides)
    pve.copyToClipboard(address, address === guest.name ? "guest name" : "address")
  }

  // ------------------------------------------------------------- lifecycle

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onOpenedChanged: if (opened) {
    cursorActive = false
    cursorIndex = 0
    overviewCursor = 0
    // Always reopen on the cluster list. A panel that reopens inside whichever
    // guest you last looked at is a panel you have to navigate out of before
    // you can see anything.
    pve.selectGuest("")
    filter = ""
    filtering = false
    // The field holds its own text independently of `filter`, so clearing only
    // the property left the previous search visible in the box the next time
    // `/` was pressed — and typing then appended to it.
    filterField.text = ""
    pve.refresh()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  onRowsChanged: clampCursor()

  Service {
    id: pve
    settings: root.settings
  }

  IpcHandler {
    target: root.ipcTarget
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): string { pve.refresh(); return "ok" }
    function status(): string {
      if (!pve.configured) return "not configured"
      return Api.hostLabel(pve.host) + " — " + Model.clusterSummary(pve.guests)
        + (pve.alarms > 0 ? ", " + pve.alarms + " alerts" : "")
    }
    // Everything the panel knows about its own health, for debugging a widget
    // that renders empty without saying why.
    function diagnose(): string {
      return JSON.stringify({
        credentialsPath: pve.credentialsPath,
        credentialsLoaded: pve.credentialsLoaded,
        credentialError: pve.credentialError,
        hasToken: pve.token !== "",
        host: pve.host,
        resolvedHost: Api.normalizeHost(pve.host),
        verifyTls: pve.verifyTls,
        caCert: pve.caCert,
        configured: pve.configured,
        refreshing: pve.refreshing,
        lastError: pve.lastError,
        lastRefreshMs: pve.lastRefreshMs,
        nodes: pve.nodes.length,
        guests: pve.guests.length,
        configsCached: Object.keys(pve.configs).length,
        agentAddresses: Object.keys(pve.agentAddresses).length,
        alarms: pve.alarms,
        selectedKey: pve.selectedKey,
        selectedAddress: pve.selectedAddress,
        statusLoaded: pve.guestStatus.key !== "",
        rdpAvailable: pve.rdpAvailable,
        rows: root.rows.length,
        cursorIndex: root.cursorIndex,
        filter: root.filter
      })
    }
  }

  // ------------------------------------------------------------- bar button

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    tooltipText: pve.configured
      ? "Proxmox — " + Api.hostLabel(pve.host) + "  ·  " + Model.clusterSummary(pve.guests)
      : "Proxmox — not configured"
    iconComponent: Component {
      Row {
        spacing: Style.space(5)

        ProxmoxIcon {
          anchors.verticalCenter: parent.verticalCenter
          iconSize: Style.space(12)
          color: root.barIconColor
          badgeColor: root.urgent
          crossed: !pve.configured
          warning: pve.configured && pve.alarms > 0
          busy: pve.busy
        }

        // The running count, because that is the number you glance at the bar
        // for. Absent when there is nothing to count, so an unconfigured or
        // empty cluster does not put a lonely 0 on the bar.
        Text {
          visible: pve.configured && pve.guests.length > 0
          anchors.verticalCenter: parent.verticalCenter
          text: String(pve.running)
          color: root.barIconColor
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
        }
      }
    }
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.RightButton) pve.refresh()
      else if (buttonCode === Qt.MiddleButton) { if (pve.host !== "") pve.openUrl(Api.normalizeHost(pve.host)) }
      else root.toggle()
    }
  }

  // ------------------------------------------------------------- panel

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(420))
    // Sized to content, capped. A fixed tall card left a four-row guest view
    // three-quarters empty. `list.contentHeight` is the sum of the delegate
    // heights and does not depend on how tall the view is, so this does not
    // feed back into itself; past the cap the list scrolls instead.
    contentHeight: panel.fittedContentHeight(
      headerColumn.implicitHeight + Style.space(18) + list.contentHeight + legend.implicitHeight,
      Style.space(760))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      // The filter field owns the keyboard while it is up; without this it
      // would fight the panel's own bindings.
      blocked: root.filtering

      onMoveRequested: function(dx, dy) {
        if (!root.cursorActive) { root.cursorActive = true; return }
        root.moveCursor(dx, dy)
      }
      onActivateRequested: if (root.cursorActive) root.activateCursor()
      // Escape unwinds one level before it closes the panel, so it is never a
      // choice between losing your place and losing the panel.
      onCloseRequested: if (!root.goBack()) root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if (t === "/") { root.filtering = true; Qt.callLater(function() { filterField.forceActiveFocus() }) }
        else if (t === "r") pve.refresh()
        else if (t === "t") root.openConsole()
        else if (t === "o") root.openWebUi()
        else if (t === "c") root.copyCurrent()
      }

      // Header pinned to the top, legend pinned to the bottom, list filling
      // what is left. A single Column would have made the list's height depend
      // on its own content, which is circular once the list can scroll.
      Column {
        id: headerColumn
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        spacing: Style.space(10)

        PanelHero {
          id: hero
          width: parent.width
          title: root.heroTitle
          meta: root.heroMeta
          detail: root.heroDetail
          foreground: root.foreground
          fontFamily: root.fontFamily
          iconOpacity: pve.configured ? 1.0 : 0.5
          iconComponent: Component {
            ProxmoxIcon {
              iconSize: Style.font.display
              color: root.foreground
              badgeColor: root.urgent
              crossed: !pve.configured
              warning: pve.configured && pve.alarms > 0
              busy: pve.busy
            }
          }
        }

        // Transient action feedback ("Console: nginx-proxy", "Copied address").
        Text {
          visible: pve.actionStatus !== ""
          width: parent.width
          text: pve.actionStatus
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.WordWrap
        }

        TextField {
          id: filterField
          visible: root.filtering
          height: visible ? implicitHeight : 0
          width: parent.width
          placeholderText: "Filter guests"
          foreground: root.foreground
          font.family: root.fontFamily
          onTextChanged: {
            root.filter = text
            root.cursorIndex = 0
            root.cursorActive = true
          }
          Keys.onPressed: function(event) {
            if (event.key === Qt.Key_Escape) {
              root.leaveSearch()
              event.accepted = true
            } else if (event.key === Qt.Key_Down || event.key === Qt.Key_Up) {
              root.moveCursor(0, event.key === Qt.Key_Down ? 1 : -1)
              event.accepted = true
            } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
              root.activateCursor()
              event.accepted = true
            }
          }
        }
      }

      // Key legend, pinned to the bottom. Cheaper than a help panel and it
      // stops the single-key shortcuts from being undiscoverable.
      Text {
        id: legend
        anchors.bottom: parent.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        text: {
          if (!pve.configured) return "r retry   esc close"
          if (root.inNode) return "j/k move   h back   t console   o web ui   c copy   r refresh"
          if (root.inGuest) return "j/k move   h back   t console   o web ui   c copy   r refresh"
          return "j/k move   ⏎ stats   t console   o web ui   / search   r refresh"
        }
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        wrapMode: Text.WordWrap
      }

      // Everything below the hero is one virtualized list. A forty-guest
      // cluster in a Repeater would build every delegate up front; this builds
      // the handful that are on screen, owns its own scroll position, and
      // keeps the cursor visible on j/k.
      ListView {
        id: list
        anchors.top: headerColumn.bottom
        anchors.topMargin: Style.space(10)
        anchors.bottom: legend.top
        anchors.bottomMargin: Style.space(8)
        anchors.left: parent.left
        anchors.right: parent.right
        spacing: Style.space(2)
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        model: root.rows
        currentIndex: root.cursorIndex
        // Deferred a turn: the model is rebuilt on every poll and on every
        // filter keystroke, and swapping it resets the view out from under an
        // immediate call.
        onCurrentIndexChanged: if (currentIndex >= 0) Qt.callLater(keepCurrentVisible)
        function keepCurrentVisible() {
          if (currentIndex >= 0 && currentIndex < count) positionViewAtIndex(currentIndex, ListView.Contain)
        }

        delegate: Item {
          id: rowItem
          required property var modelData
          required property int index

          width: ListView.view.width
          height: rowColumn.implicitHeight

          Column {
            id: rowColumn
            width: parent.width
            spacing: Style.space(4)

            // Breathing room above a section rule. It has to be its own item:
            // padding the separator's own height paints the whole thing, and a
            // 1px rule becomes a nine-pixel slab.
            Item {
              visible: rowItem.index > 0 && rowItem.modelData.sectionTitle !== ""
              width: 1
              height: Style.space(8)
            }

            PanelSeparator {
              visible: rowItem.index > 0 && rowItem.modelData.sectionTitle !== ""
              foreground: root.foreground
            }

            PanelSectionHeader {
              visible: rowItem.modelData.sectionTitle !== ""
              text: rowItem.modelData.sectionTitle
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            Loader {
              id: rowLoader
              width: parent.width
              sourceComponent: {
                switch (rowItem.modelData.kind) {
                case "guest": return guestComponent
                case "node": return nodeComponent
                case "meter": return meterComponent
                case "kv": return kvComponent
                }
                return noteComponent
              }
            }

            // Bindings rather than assignment in onLoaded: the ListView
            // recycles delegates, so the item outlives the modelData it was
            // first handed and would otherwise render a stale row.
            Binding {
              target: rowLoader.item
              property: "row"
              value: rowItem.modelData
              when: rowLoader.item !== null
            }

            Binding {
              target: rowLoader.item
              property: "rowIndex"
              value: rowItem.index
              when: rowLoader.item !== null
            }
          }
        }
      }
    }
  }

  // ------------------------------------------------------------- row types

  // The status light. A filled disc for running, a hollow ring for stopped, a
  // dimmed disc for held, and `urgent` for anything wrong — form first, colour
  // only where the theme guarantees one.
  component StatusLed: Item {
    id: led
    property string state: "stop"
    readonly property color tint: root.ledColor(led.state)
    readonly property bool hollow: led.state === "stop"

    implicitWidth: Style.space(8)
    implicitHeight: Style.space(8)

    Rectangle {
      anchors.centerIn: parent
      width: Style.space(7)
      height: width
      radius: width / 2
      color: led.hollow ? "transparent" : led.tint
      border.width: led.hollow ? Math.max(1, Style.space(1)) : 0
      border.color: led.tint
    }

    // A soft halo, only on the two states that mean "look at me". At 7px a
    // second ring is the difference between a lit indicator and a printed dot.
    Rectangle {
      visible: led.state === "run" || led.state === "crit"
      anchors.centerIn: parent
      width: Style.space(12)
      height: width
      radius: width / 2
      color: "transparent"
      border.width: Math.max(1, Style.space(1))
      border.color: Util.alpha(led.tint, 0.22)
    }
  }

  // A thin meter. Shared by node rows and the guest view so a bar means the
  // same thing wherever it appears.
  component Meter: Item {
    id: meter

    // Bind these three; everything else is internal.
    property real percent: 0
    property string level: "ok"
    // Stable identity for this bar across polls. Without one the meter cannot
    // know where it last stood, and animates from zero every time.
    property string mkey: ""

    readonly property real target: Util.clamp(Number(percent) || 0, 0, 1)
    property real fill: 0
    property bool seeded: false
    // The key `fill` currently reflects, so re-seeding happens once per key
    // rather than on every ordinary glide toward a new target.
    property string seededKey: ""

    implicitHeight: Math.max(Style.space(4), Math.round(Style.spacing.controlHeight * 0.14))

    Rectangle {
      id: meterTrack
      anchors.fill: parent
      radius: height / 2
      color: root.track
    }

    Rectangle {
      anchors.left: meterTrack.left
      anchors.verticalCenter: meterTrack.verticalCenter
      height: meterTrack.height
      radius: meterTrack.radius
      width: meterTrack.width * meter.fill
      // Warn is the same colour at reduced strength rather than a second hue,
      // so a filling meter reads as "on the way there" instead of as a
      // different kind of problem.
      color: meter.level === "crit" ? root.urgent
        : (meter.level === "warn" ? Util.alpha(root.urgent, 0.75) : root.foreground)
    }

    // Only animates once the bar has been seeded, so the jump to the
    // remembered level on creation is instant and invisible.
    Behavior on fill {
      enabled: meter.seeded
      NumberAnimation { duration: 200; easing.type: Easing.OutCubic }
    }

    // Every poll rebuilds the row model, which destroys and rebuilds these
    // delegates — a fresh meter has no idea the same bar was already on screen
    // at 40%, so it starts at zero and sweeps up, all of them together. The
    // panel remembers the last level per key, so a rebuilt bar can start where
    // its predecessor stopped and simply glide to the new reading.
    //
    // The guest-view meters sit behind a Loader whose `item.row` is attached
    // by an external Binding a beat after this Item is constructed (see
    // `rowLoader` above) — so `percent`/`mkey` read 0/"" at construction and
    // only become real once that Binding fires. Seeding straight from
    // Component.onCompleted therefore seeds from that placeholder, locks
    // fill at 0, and then animates up when the real value lands a moment
    // later — the exact zero-flash this is meant to prevent. Qt.callLater
    // defers the seed until the current update cascade has fully settled, so
    // percent, level and mkey are all real by the time it runs.
    function reseed() {
      if (meter.mkey === "" || meter.mkey === meter.seededKey) return
      meter.seededKey = meter.mkey
      var remembered = root.meterValues[meter.mkey]
      var start = remembered !== undefined ? remembered : meter.target
      meter.seeded = false
      meter.fill = start
      meter.seeded = true
      meter.fill = meter.target
    }

    onMkeyChanged: Qt.callLater(reseed)
    Component.onCompleted: Qt.callLater(reseed)

    // Ordinary updates once already seeded to this key: glide to the new
    // reading. Guarded on seededKey so a target that lands before the
    // deferred reseed has run — still attributed to the "" placeholder key —
    // cannot jump the bar ahead of the seed.
    onTargetChanged: if (meter.seeded && meter.mkey === meter.seededKey) meter.fill = meter.target

    // Recorded continuously rather than only at the end, so a delegate torn
    // down mid-sweep is replaced by one that resumes from the same place.
    onFillChanged: if (meter.mkey !== "") root.meterValues[meter.mkey] = meter.fill
  }

  // A guest: console button, LED, vmid, name over a status line, and the
  // figures at the right edge.
  component GuestRow: CursorSurface {
    id: entry
    property var row: null
    property int rowIndex: -1

    readonly property bool hasConsole: !!(row && row.console !== "none")
    readonly property bool isRdp: !!(row && row.console === "rdp")
    readonly property real consoleInset: Style.space(26)

    hasCursor: root.cursorActive && root.cursorIndex === rowIndex
    foreground: root.foreground
    fill: root.hoverFill
    currentFill: root.selectedFill
    implicitHeight: entryInner.implicitHeight + Style.spacing.lg

    Row {
      id: entryInner
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.space(6) + entry.consoleInset
      anchors.rightMargin: Style.space(8)
      spacing: Style.space(8)

      StatusLed {
        anchors.verticalCenter: parent.verticalCenter
        state: entry.row ? String(entry.row.led || "stop") : "stop"
      }

      Text {
        id: vmidText
        anchors.verticalCenter: parent.verticalCenter
        text: entry.row && entry.row.vmid > 0 ? String(entry.row.vmid) : ""
        color: root.faint
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        width: Style.space(26)
        horizontalAlignment: Text.AlignRight
      }

      Column {
        width: parent.width - Style.space(8) - vmidText.width - trailingText.width - Style.space(24)
        anchors.verticalCenter: parent.verticalCenter
        spacing: Style.space(1)

        Text {
          width: parent.width
          text: entry.row ? String(entry.row.name || "") : ""
          color: entry.row && entry.row.alarming ? root.urgent
            : (entry.row && entry.row.state !== "running" ? root.dim : root.foreground)
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          elide: Text.ElideRight
        }

        Text {
          width: parent.width
          visible: text !== ""
          text: entry.row ? String(entry.row.detail || "") : ""
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
        }
      }

      Text {
        id: trailingText
        anchors.verticalCenter: parent.verticalCenter
        text: entry.row ? String(entry.row.trailing || "") : ""
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }
    }

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onEntered: root.setCursor(entry.rowIndex)
      onClicked: { root.setCursor(entry.rowIndex); root.activateCursor() }
    }

    // Declared after the row-wide MouseArea so it wins the click: the row opens
    // the guest's stats, this opens a session on it. Two destinations, two
    // targets.
    //
    // A stopped guest keeps the button in place, dimmed and inert, rather than
    // losing it — a row that changes width when a guest shuts down makes the
    // whole list jump.
    PanelActionButton {
      visible: !!(entry.row && entry.row.vtype !== "node")
      enabled: entry.hasConsole
      anchors.left: parent.left
      anchors.leftMargin: Style.space(3)
      anchors.verticalCenter: parent.verticalCenter
      iconText: entry.isRdp ? Model.glyphFor("rdp") : Model.glyphFor("terminal")
      tooltipText: {
        if (!entry.row) return ""
        if (!entry.hasConsole) return entry.row.name + " is not running"
        return entry.isRdp ? "Remote desktop to " + entry.row.name
          : "Console on " + entry.row.name
      }
      foreground: root.dim
      hoverColor: root.foreground
      fontFamily: root.fontFamily
      fontSize: Style.font.bodySmall
      size: Style.space(20)
      bordered: true
      onClicked: {
        root.setCursor(entry.rowIndex)
        if (entry.row && entry.row.guest) { pve.openConsole(entry.row.guest); root.close() }
      }
    }
  }

  // A node: name and hardware on the title line, then a labelled meter each
  // for CPU and memory. Two meters rather than one, because the number that
  // matters is usually memory and a single unlabelled bar never said which.
  component NodeRow: CursorSurface {
    id: nodeEntry
    property var row: null
    property int rowIndex: -1

    hasCursor: root.cursorActive && root.cursorIndex === rowIndex
    foreground: root.foreground
    fill: root.hoverFill
    currentFill: root.selectedFill
    implicitHeight: nodeInner.implicitHeight + Style.spacing.lg

    Column {
      id: nodeInner
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.space(8)
      anchors.rightMargin: Style.space(8)
      spacing: Style.space(5)

      Item {
        width: parent.width
        implicitHeight: Math.max(nodeName.implicitHeight, nodeDetail.implicitHeight)

        Text {
          id: nodeName
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          text: nodeEntry.row ? String(nodeEntry.row.name || "") : ""
          color: nodeEntry.row && nodeEntry.row.alarming ? root.urgent : root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
        }

        Text {
          id: nodeDetail
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          text: nodeEntry.row ? String(nodeEntry.row.detail || "") : ""
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }

      Repeater {
        model: nodeEntry.row && nodeEntry.row.meters ? nodeEntry.row.meters : []

        Row {
          required property var modelData
          width: nodeInner.width
          spacing: Style.space(8)

          Text {
            id: meterLabel
            anchors.verticalCenter: parent.verticalCenter
            text: String(modelData.label || "").toUpperCase()
            color: root.faint
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            font.letterSpacing: 0.8
            width: Style.space(24)
          }

          Meter {
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width - meterLabel.width - meterValue.width - Style.space(16)
            percent: Number(modelData.percent) || 0
            level: String(modelData.level || "ok")
            mkey: String(modelData.key || "")
          }

          Text {
            id: meterValue
            anchors.verticalCenter: parent.verticalCenter
            text: String(modelData.text || "")
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            width: Style.space(58)
            horizontalAlignment: Text.AlignRight
          }
        }
      }
    }
  }

  // One figure in the guest view: label and percentage on a line, the bar
  // under it, the absolute numbers under that.
  component MeterRow: CursorSurface {
    id: meterEntry
    property var row: null
    property int rowIndex: -1

    hasCursor: root.cursorActive && root.cursorIndex === rowIndex
    foreground: root.foreground
    fill: root.hoverFill
    currentFill: root.selectedFill
    implicitHeight: meterInner.implicitHeight + Style.spacing.lg

    Column {
      id: meterInner
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.space(8)
      anchors.rightMargin: Style.space(8)
      spacing: Style.space(5)

      Item {
        width: parent.width
        implicitHeight: Math.max(meterTitle.implicitHeight, meterReading.implicitHeight)

        Text {
          id: meterTitle
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          text: meterEntry.row ? String(meterEntry.row.title || "") : ""
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
        }

        Text {
          id: meterReading
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          text: meterEntry.row ? String(meterEntry.row.value || "") : ""
          color: meterEntry.row && meterEntry.row.level === "crit" ? root.urgent : root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }

      Meter {
        width: parent.width
        percent: meterEntry.row ? Number(meterEntry.row.percent) || 0 : 0
        level: meterEntry.row ? String(meterEntry.row.level || "ok") : "ok"
        mkey: meterEntry.row ? String(meterEntry.row.key || "") : ""
      }

      Text {
        width: parent.width
        visible: text !== ""
        text: meterEntry.row ? String(meterEntry.row.detail || "") : ""
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        elide: Text.ElideRight
      }
    }
  }

  // A fact: label left, value right. One line, because these are things you
  // read once and none of them deserve two.
  component KvRow: CursorSurface {
    id: kvEntry
    property var row: null
    property int rowIndex: -1

    hasCursor: root.cursorActive && root.cursorIndex === rowIndex
    foreground: root.foreground
    fill: root.hoverFill
    currentFill: root.selectedFill
    implicitHeight: kvInner.implicitHeight + Style.spacing.md

    Item {
      id: kvInner
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.space(8)
      anchors.rightMargin: Style.space(8)
      implicitHeight: Math.max(kvTitle.implicitHeight, kvValue.implicitHeight)

      Text {
        id: kvTitle
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        width: Style.space(74)
        text: kvEntry.row ? String(kvEntry.row.title || "") : ""
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        elide: Text.ElideRight
      }

      Text {
        id: kvValue
        anchors.left: kvTitle.right
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        text: kvEntry.row ? String(kvEntry.row.value || "") : ""
        color: {
          if (!kvEntry.row) return root.foreground
          if (kvEntry.row.tone === "warn") return root.urgent
          if (kvEntry.row.tone === "dim") return root.dim
          return root.foreground
        }
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        elide: Text.ElideRight
      }
    }
  }

  component NoteRow: CursorSurface {
    id: note
    property var row: null
    property int rowIndex: -1

    readonly property bool isLink: !!(note.row && note.row.link)

    hasCursor: root.cursorActive && root.cursorIndex === rowIndex
    // Link notes are always painted selected — a permanent affordance that
    // the row is actionable, with no dependence on hover or cursor state.
    current: note.isLink
    foreground: root.foreground
    fill: root.hoverFill
    currentFill: root.selectedFill
    implicitHeight: noteText.implicitHeight + Style.spacing.lg

    Text {
      id: noteText
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.space(8)
      anchors.rightMargin: Style.space(8)
      text: note.row ? String(note.row.name || "") : ""
      color: note.isLink ? root.foreground : root.dim
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
    }

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: note.isLink ? Qt.PointingHandCursor : Qt.ArrowCursor
      onEntered: root.setCursor(note.rowIndex)
      onClicked: {
        root.setCursor(note.rowIndex)
        if (note.isLink) pve.openUrl(note.row.link)
      }
    }
  }

  Component { id: guestComponent; GuestRow {} }
  Component { id: nodeComponent; NodeRow {} }
  Component { id: meterComponent; MeterRow {} }
  Component { id: kvComponent; KvRow {} }
  Component { id: noteComponent; NoteRow {} }
}
