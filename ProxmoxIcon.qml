import QtQuick
import qs.Commons

// A stack of layers: one filled plate on top, two outlined beneath it. Drawn
// from primitives rather than shipped as an SVG because a 16px bar slot is
// small enough that Qt's SVG rasterizer loses the thin strokes, and a Canvas
// path stays crisp at any slot size and recolors with the theme without a
// second asset for light backgrounds.
//
// Deliberately not the Proxmox logo. This is a third-party plugin and the mark
// belongs to someone else; a generic stack says "hosts with things on them"
// without borrowing a trademark to say it.
Item {
  id: root

  property real iconSize: Style.font.icon
  property color color: Color.foreground
  property color badgeColor: Color.urgent
  property bool crossed: false
  property bool warning: false
  property bool busy: false

  width: iconSize
  height: iconSize
  implicitWidth: iconSize
  implicitHeight: iconSize

  Canvas {
    id: mark
    anchors.fill: parent
    antialiasing: true
    opacity: root.busy ? 0.55 : 1.0

    Connections {
      target: root
      function onColorChanged() { mark.requestPaint() }
      function onIconSizeChanged() { mark.requestPaint() }
    }

    Behavior on opacity {
      NumberAnimation { duration: 200; easing.type: Easing.OutCubic }
    }

    // Coordinates are a 0..1 unit box so the shape scales with the slot.
    onPaint: {
      var ctx = getContext("2d")
      var s = Math.min(width, height)
      var ox = (width - s) / 2
      var oy = (height - s) / 2
      function px(u) { return ox + u * s }
      function py(v) { return oy + v * s }

      ctx.reset()
      ctx.lineJoin = "round"
      ctx.lineCap = "round"
      ctx.strokeStyle = root.color
      ctx.fillStyle = root.color

      // The top plate is filled so the mark still reads as a solid shape at
      // bar size, where three outlines would blur into a single grey smudge.
      ctx.beginPath()
      ctx.moveTo(px(0.50), py(0.08))
      ctx.lineTo(px(0.94), py(0.32))
      ctx.lineTo(px(0.50), py(0.56))
      ctx.lineTo(px(0.06), py(0.32))
      ctx.closePath()
      ctx.fill()

      // Two plates below it, as strokes. Line width scales with the slot so
      // the proportions hold from a 12px bar icon to the 24px hero.
      ctx.lineWidth = Math.max(1, s * 0.09)
      ctx.beginPath()
      ctx.moveTo(px(0.10), py(0.50))
      ctx.lineTo(px(0.50), py(0.72))
      ctx.lineTo(px(0.90), py(0.50))
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(px(0.10), py(0.68))
      ctx.lineTo(px(0.50), py(0.90))
      ctx.lineTo(px(0.90), py(0.68))
      ctx.stroke()
    }
  }

  // "Not configured / cannot reach the cluster". Drawn over the mark rather
  // than swapping it out, so the icon keeps the same silhouette and slot width
  // in every state.
  Rectangle {
    visible: root.crossed
    anchors.centerIn: parent
    width: Math.round(root.iconSize * 1.15)
    height: Math.max(1, Math.round(root.iconSize * 0.10))
    radius: height / 2
    rotation: -45
    color: root.color
  }

  // Corner badge for anything under Needs attention. Small enough not to
  // disturb the mark, urgent-colored so it reads at a glance from across the
  // bar.
  Rectangle {
    visible: root.warning
    anchors.right: parent.right
    anchors.top: parent.top
    anchors.rightMargin: -Math.round(root.iconSize * 0.06)
    anchors.topMargin: -Math.round(root.iconSize * 0.06)
    width: Math.max(3, Math.round(root.iconSize * 0.34))
    height: width
    radius: width / 2
    color: root.badgeColor
  }
}
