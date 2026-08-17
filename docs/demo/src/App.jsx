import { useEffect, useRef, useState } from "react";
import DemoBar from "./Bar.jsx";
import THEMES from "./themes.js";

const INSTALL_CMD =
  "omarchy plugin add https://github.com/AndresSM415/omaprox.git --enable";

/* ------------------------------------------------------------------ marks */

function Mark({ size = 20, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.6 14 4.6 8 7.6 2 4.6 8 1.6Z" style={{ stroke: color }} strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M2 8 8 11 14 8" style={{ stroke: color }} strokeWidth="1.1" strokeLinejoin="round" opacity=".8" />
      <path d="M2 11.4 8 14.4 14 11.4" style={{ stroke: color }} strokeWidth="1.1" strokeLinejoin="round" opacity=".5" />
    </svg>
  );
}

function ContainerMark({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="4.2" width="12" height="8" rx="1.3" stroke="currentColor" strokeWidth="1.1" />
      <path d="M2 7h12" stroke="currentColor" strokeWidth="1.1" opacity=".55" />
      <path d="M4.4 9.6h2.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}

function VmMark({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.4" y="2" width="11.2" height="12" rx="1.3" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4.8 4.6h6.4M4.8 7h6.4M4.8 9.4h3.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}

function TerminalGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 4.2 5.8 7 3 9.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.6 10h3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function RdpGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.6" y="2.4" width="10.8" height="7.4" rx="1.1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.2 12h3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------- panel bits */

function Hero({ mark, title, meta, badge, badgeTone }) {
  return (
    <div className="hero">
      <span className="mark">{mark}</span>
      <span className="txt">
        <span className="title">{title}</span>
        <span className="meta">{meta}</span>
      </span>
      {badge && <span className={`badge ${badgeTone || ""}`}>{badge}</span>}
    </div>
  );
}

function SectionHead({ children }) {
  return <div className="shead">{children}</div>;
}

function Led({ state }) {
  return <span className={`led ${state}`} aria-hidden="true" />;
}

function GuestRow({ guest }) {
  const cls = [
    "row",
    guest.cursor && "cursor",
    guest.hovered && "hovered",
    guest.alarm && "alarm",
    guest.state === "stop" && "dimmed",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <span
        className={["tbtn", guest.console === "rdp" && "rdp", guest.state === "stop" && "off"]
          .filter(Boolean)
          .join(" ")}
        title={guest.consoleHint}
        aria-hidden="true"
      >
        {guest.console === "rdp" ? <RdpGlyph /> : <TerminalGlyph />}
      </span>
      <Led state={guest.state === "stop" ? "stop" : guest.led === "crit" ? "crit" : "run"} />
      <span className="vmid">{guest.vmid}</span>
      <span className="name">
        <b>{guest.name}</b>
        <small>{guest.detail}</small>
      </span>
      <span className="trail">{guest.trail}</span>
    </div>
  );
}

function Meter({ pct, tone }) {
  return (
    <div className="meter">
      <i className={tone || ""} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Stat({ label, value, pct, tone, sub, valueMute }) {
  return (
    <div className="stat">
      <div className="line">
        <b>{label}</b>
        <span className={valueMute ? "mute" : ""}>{value}</span>
      </div>
      <Meter pct={pct} tone={tone} />
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function NodeStat({ node }) {
  return (
    <div className="stat">
      <div className="line">
        <b>{node.name}</b>
        <span className="mute">
          {node.cores} cores &nbsp;·&nbsp; up {node.uptime}
        </span>
      </div>
      <div className="mrow">
        <em>cpu</em>
        <Meter pct={node.cpu} />
        <span>{node.cpu}%</span>
      </div>
      <div className="mrow">
        <em>mem</em>
        <Meter pct={node.mem} tone={node.mem >= 80 ? "warn" : ""} />
        <span>{node.memText}</span>
      </div>
    </div>
  );
}

function Kv({ k, v, tone }) {
  return (
    <div className="kv">
      <b>{k}</b>
      <span className={tone || ""}>{v}</span>
    </div>
  );
}

function Panel({ children }) {
  return <article className="panel">{children}</article>;
}

/* ------------------------------------------------------------------- data */

const ATTENTION = [
  { vmid: 204, name: "truenas", detail: "io delay 18% · 12 min", trail: "pve02", led: "crit", alarm: true, console: "terminal", state: "run" },
  { vmid: 105, name: "gitea", detail: "stopped · autostart on", trail: "pve01", led: "stop", console: "terminal", state: "stop" },
];

const NODES = [
  { name: "pve01", cores: 12, uptime: "41d", cpu: 22, mem: 38, memText: "24.6/64G" },
  { name: "pve02", cores: 8, uptime: "41d", cpu: 41, mem: 87, memText: "27.9/32G" },
];

const CONTAINERS = [
  { vmid: 101, name: "nginx-proxy", detail: "debian 12 · 12d", trail: "4.2% · 412M", cursor: true, console: "terminal", state: "run", consoleHint: "pct enter 101" },
  { vmid: 102, name: "pihole", detail: "debian 12 · 41d", trail: "1.1% · 196M", console: "terminal", state: "run" },
  { vmid: 103, name: "jellyfin", detail: "ubuntu 24.04 · 8d", trail: "38% · 2.1G", console: "terminal", state: "run" },
  { vmid: 104, name: "postgres", detail: "debian 12 · 41d", trail: "6.8% · 1.4G", console: "terminal", state: "run" },
  { vmid: 105, name: "gitea", detail: "stopped", trail: "—", console: "terminal", state: "stop" },
  { vmid: 110, name: "wireguard", detail: "alpine 3.20 · 41d", trail: "0.2% · 64M", console: "terminal", state: "run" },
];

const VMS = [
  { vmid: 202, name: "win-srv-2022", detail: "windows · rdp :3389", trail: "11.8% · 6.1G", hovered: true, console: "rdp", state: "run", consoleHint: "xfreerdp3 /v:10.0.20.42" },
  { vmid: 203, name: "home-assistant", detail: "haos 13 · agent ok", trail: "9.4% · 2.8G", console: "terminal", state: "run" },
  { vmid: 204, name: "truenas", detail: "io delay 18%", trail: "5.1% · 12.0G", led: "crit", alarm: true, console: "terminal", state: "run" },
  { vmid: 205, name: "win11-lab", detail: "stopped", trail: "—", console: "rdp", state: "stop" },
];

/* ---------------------------------------------------------------- panels */

function OverviewPanel() {
  return (
    <Panel>
      <Hero
        mark={<Mark />}
        title="homelab"
        meta="8 up · 2 down"
        badge="2 ALERTS"
        badgeTone="warn"
      />
      <SectionHead>Needs attention</SectionHead>
      <div className="rows">
        {ATTENTION.map((g) => (
          <GuestRow key={g.vmid} guest={g} />
        ))}
      </div>
      <div className="rule" />
      <SectionHead>Nodes</SectionHead>
      <div className="rows">
        {NODES.map((n) => (
          <NodeStat key={n.name} node={n} />
        ))}
      </div>
      <div className="rule" />
      <SectionHead>Containers · 6</SectionHead>
      <div className="rows">
        {CONTAINERS.map((g) => (
          <GuestRow key={g.vmid} guest={g} />
        ))}
      </div>
      <div className="rule" />
      <SectionHead>Virtual machines · 4</SectionHead>
      <div className="rows">
        {VMS.map((g) => (
          <GuestRow key={g.vmid} guest={g} />
        ))}
      </div>
      <div className="legend">
        j/k move &nbsp; ⏎ stats &nbsp; t console &nbsp; / search &nbsp; r refresh
      </div>
    </Panel>
  );
}

function ContainerPanel() {
  return (
    <Panel>
      <Hero
        mark={<ContainerMark />}
        title="nginx-proxy"
        meta="LXC 101 · pve01 · h to go back"
        badge="RUNNING"
        badgeTone="run"
      />
      <SectionHead>Resources</SectionHead>
      <div className="rows">
        <Stat label="CPU" value="4.2%" pct={4.2} sub="2 cores · load 0.08" />
        <Stat label="Memory" value="40%" pct={40} sub="412 MB / 1.0 GB" />
        <Stat label="Swap" value="0%" pct={1} sub="0 B / 512 MB" />
        <Stat label="Rootfs" value="39%" pct={39} sub="3.1 GB / 8.0 GB · local-lvm" />
      </div>
      <div className="rule" />
      <SectionHead>Traffic · since boot</SectionHead>
      <div className="rows">
        <Kv k="Network" v="↓ 1.2 GB · ↑ 380 MB" />
        <Kv k="Now" v="↓ 42 KB/s · ↑ 8 KB/s" tone="mute" />
        <Kv k="Disk I/O" v="r 84 MB · w 1.4 GB" tone="mute" />
      </div>
      <div className="rule" />
      <SectionHead>Guest</SectionHead>
      <div className="rows">
        <Kv k="Uptime" v="12d 4h 51m" />
        <Kv k="Address" v="10.0.20.11/24" />
        <Kv k="Type" v="unprivileged · nesting" tone="mute" />
        <Kv k="Boot" v="autostart · order 2" tone="mute" />
        <Kv k="Backup" v="ok · 6h ago · pbs01" tone="ok" />
      </div>
      <div className="legend">
        t opens <span style={{ color: "var(--fg)" }}>pct enter 101</span> in a floating terminal
        <br />
        h back &nbsp; ⏎ web UI &nbsp; c copy vmid &nbsp; r refresh
      </div>
    </Panel>
  );
}

function VmPanel() {
  return (
    <Panel>
      <Hero
        mark={<VmMark />}
        title="win-srv-2022"
        meta="QEMU 202 · pve01 · h to go back"
        badge="RUNNING"
        badgeTone="run"
      />
      <SectionHead>Resources</SectionHead>
      <div className="rows">
        <Stat label="CPU" value="11.8%" pct={11.8} sub="4 vcpu · host · 1 socket" />
        <Stat label="Memory" value="76%" pct={76} tone="warn" sub="6.1 GB / 8.0 GB · balloon on" />
        <Stat label="scsi0" value="62%" pct={62} sub="74 GB / 120 GB · local-zfs" />
        <Stat label="Host share" value="4%" pct={4} sub="0.47 of 12 cores on pve01" />
      </div>
      <div className="rule" />
      <SectionHead>Traffic · since boot</SectionHead>
      <div className="rows">
        <Kv k="Network" v="↓ 44 GB · ↑ 9.6 GB" />
        <Kv k="Now" v="↓ 1.1 MB/s · ↑ 210 KB/s" tone="mute" />
        <Kv k="Disk I/O" v="r 12 GB · w 31 GB" tone="mute" />
      </div>
      <div className="rule" />
      <SectionHead>Guest</SectionHead>
      <div className="rows">
        <Kv k="Uptime" v="6d 11h 02m" />
        <Kv k="OS" v="Windows Server 2022" />
        <Kv k="Address" v="10.0.20.42/24" />
        <Kv k="Agent" v="qemu-guest-agent 108.0.1" tone="ok" />
        <Kv k="Console" v={<span style={{ color: "var(--rdp)" }}>rdp :3389</span>} />
        <Kv k="Backup" v="ok · 6h ago · pbs01" tone="ok" />
      </div>
      <div className="legend">
        t opens <span style={{ color: "var(--rdp)" }}>xfreerdp3 /v:10.0.20.42</span>
        <br />
        h back &nbsp; ⏎ web UI &nbsp; c copy address &nbsp; r refresh
      </div>
    </Panel>
  );
}

function ThemedStage({ t }) {
  return (
    <div className="themed-stage" style={paletteVars(t)}>
      <DemoBar />

      <div className="panels">
        <OverviewPanel />
        <ContainerPanel />
        <VmPanel />
      </div>

      <div className="popups">
        <div className="win focused">
          <div className="win-bar">
            <span className="dot" />
            <span>pct enter 101 — nginx-proxy — floating</span>
          </div>
          <div className="win-body">
            <div>
              <span className="d">dr@omarchy</span> ~ <span className="p">❯</span> ssh -t
              root@pve01 pct enter 101
            </div>
            <div>&nbsp;</div>
            <div>
              <span className="c">root@nginx-proxy</span>:<span className="d">~</span>#
              systemctl is-active nginx
            </div>
            <div className="p">active</div>
            <div>
              <span className="c">root@nginx-proxy</span>:<span className="d">~</span>#{" "}
              <span className="caret" />
            </div>
          </div>
        </div>

        <div className="win">
          <div className="win-bar">
            <span className="dot" />
            <span>xfreerdp3 /v:10.0.20.42 — win-srv-2022</span>
          </div>
          <div className="win-body">
            <div className="rdp-note">
              remote session
              <br />
              <span style={{ opacity: 0.7 }}>10.0.20.42:3389 · /dynamic-resolution /clipboard</span>
            </div>
            <div className="rdp-task">
              <span style={{ color: "var(--rdp)" }}>⊞</span>
              <span>win-srv-2022</span>
              <span style={{ marginLeft: "auto" }}>13:42</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- encoding */

function LedTable() {
  const rows = [
    {
      swatch: (
        <i style={{ background: "#5cc46b", boxShadow: "0 0 6px rgba(92,196,107,.75)" }} />
      ),
      label: "filled, lit",
      meaning: (
        <>
          running — status <code>running</code>, no alarm
        </>
      ),
    },
    {
      swatch: (
        <i
          style={{ background: "transparent", boxShadow: "inset 0 0 0 1.5px #4a545e" }}
        />
      ),
      label: "hollow",
      meaning: <>stopped. The row dims, the trailing figures collapse to an em dash</>,
    },
    {
      swatch: (
        <i style={{ background: "#e0a33e", boxShadow: "0 0 6px rgba(224,163,62,.55)" }} />
      ),
      label: "amber",
      meaning: <>paused or suspended — memory still held, CPU idle</>,
    },
    {
      swatch: (
        <i style={{ background: "#e0524e", boxShadow: "0 0 7px rgba(224,82,78,.8)" }} />
      ),
      label: "red",
      meaning: (
        <>
          running but unhappy: high IO delay, failed backup, autostart guest that is
          down
        </>
      ),
    },
  ];
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>LED</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="k">
                <span className="swatch">
                  {r.swatch} {r.label}
                </span>
              </td>
              <td className="v">{r.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConsoleTable() {
  const rows = [
    { k: "LXC", v: <><code>pct enter &lt;vmid&gt;</code> on the guest's node</> },
    { k: "VM, Linux", v: <>SSH to the guest itself, one-time key setup offered</> },
    { k: "VM, Windows", v: <><code>xfreerdp3</code> against the resolved address</> },
    { k: "Stopped", v: <>dimmed and inert — the plugin will not start a guest to give you a shell</> },
  ];
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Console button</th>
            <th>Opens</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k}>
              <td className="k">{r.k}</td>
              <td className="v">{r.v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- install */

function InstallBlock() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — the command is still visible */
    }
  };
  return (
    <div className="install">
      <code>{INSTALL_CMD}</code>
      <button onClick={copy} aria-label="Copy install command">
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------- theme carousel */

// The plugin reads a theme's colors.toml and derives the rest with the same
// arithmetic Qt applies: dim = fg / 1.55, faint = fg / 2.2, and alpha tracks
// over the foreground. Repeating that here keeps the demo honest.
function hexToRgb(hex) {
  const h = String(hex).replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function paletteVars(t) {
  const fg = t.fg;
  const scale = (c, f) => {
    const { r, g, b } = hexToRgb(c);
    return `rgb(${Math.round(r / f)}, ${Math.round(g / f)}, ${Math.round(b / f)})`;
  };
  const alpha = (c, a) => {
    const { r, g, b } = hexToRgb(c);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  };
  return {
    "--panel-bg": t.bg,
    "--panel-bg-2": t.bg2,
    "--accent": t.accent,
    "--panel-edge": alpha(t.accent, 0.55),
    "--fg": fg,
    "--fg-dim": scale(fg, 1.55),
    "--fg-faint": scale(fg, 2.2),
    "--track": alpha(fg, 0.14),
    "--sel": alpha(fg, 0.07),
    "--sel-edge": alpha(fg, 0.22),
    "--crit": t.red,
  };
}

function ThemeCarousel() {
  const trackRef = useRef(null);
  const drag = useRef(null);
  const [index, setIndex] = useState(0);

  const slideStep = () => {
    const el = trackRef.current;
    const slide = el && el.firstElementChild;
    return slide ? slide.getBoundingClientRect().width + 18 : 1;
  };

  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    const n = Math.round(el.scrollLeft / slideStep());
    setIndex(Math.min(THEMES.length - 1, Math.max(0, n)));
  };

  const nudge = (dir) =>
    trackRef.current &&
    trackRef.current.scrollBy({ left: dir * slideStep(), behavior: "smooth" });

  // Auto-advance every 10 seconds, wrapping at the end. Manual scrolling just
  // changes where the next tick lands.
  useEffect(() => {
    const id = setInterval(() => {
      const el = trackRef.current;
      if (!el) return;
      const step = slideStep();
      const at = Math.round(el.scrollLeft / step);
      const next = (at + 1) % THEMES.length;
      el.scrollTo({ left: next * step, behavior: "smooth" });
    }, 10000);
    return () => clearInterval(id);
  }, []);

  const onPointerDown = (e) => {
    const el = trackRef.current;
    drag.current = { x: e.clientX, scroll: el.scrollLeft, active: true };
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current || !drag.current.active) return;
    trackRef.current.scrollLeft = drag.current.scroll - (e.clientX - drag.current.x);
  };
  const onPointerUp = () => {
    if (drag.current) drag.current.active = false;
  };

  return (
    <div className="carousel">
      <div className="carousel-nav">
        <button onClick={() => nudge(-1)} aria-label="Previous theme">
          ←
        </button>
        <span className="carousel-theme">
          {THEMES[index].name} <span className="muted">{THEMES[index].mode}</span>
        </span>
        <span className="carousel-count">
          {index + 1} / {THEMES.length}
        </span>
        <button onClick={() => nudge(1)} aria-label="Next theme">
          →
        </button>
      </div>
      <div
        className="track"
        ref={trackRef}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {THEMES.map((t) => (
          <div className="slide" key={t.id}>
            <ThemedStage t={t} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- the page */

export default function App() {
  const [theme, setTheme] = useState(() => {
    if (typeof document !== "undefined" && document.documentElement.dataset.theme)
      return document.documentElement.dataset.theme;
    return "auto";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  const cycle = () =>
    setTheme((t) => (t === "auto" ? "dark" : t === "dark" ? "light" : "auto"));

  return (
    <div className="wrap">
      <header className="masthead">
        <div className="masthead-top">
          <div className="eyebrow">
            Omarchy <b>4 · Quattro</b> — Quickshell bar plugin
          </div>
          <div className="masthead-actions">
            <a className="repo-link" href="https://github.com/AndresSM415/omaprox">
              github ↗
            </a>
            <button className="theme-btn" onClick={cycle} aria-label="Toggle theme">
              {theme === "auto" ? "theme: auto" : `theme: ${theme}`}
            </button>
          </div>
        </div>
        <h1>
          oma<span>prox</span>
        </h1>
        <p className="lede">
          A read-only Proxmox VE panel that hangs off the Omarchy bar. It answers{" "}
          <em>what is running, what died, and how hard is it working</em> — then gets out
          of the way. Nothing in the panel starts, stops, migrates or reconfigures a
          guest; the only thing it opens is a window you were going to open anyway.
        </p>
        <div className="facts">
          <span className="fact hot">read-only</span>
          <span className="fact">bar-widget</span>
          <span className="fact">lxc + qemu</span>
          <span className="fact">keyboard-first</span>
          <span className="fact">MIT</span>
        </div>
        <InstallBlock />
      </header>

      <section>
        <div className="sec-head">
          <div className="sec-num">The panel</div>
          <h2>One list, then one guest</h2>
          <p>
            The bar icon carries the running count and turns amber when something needs
            looking at. Click it and the panel drops: every container and VM on the
            cluster, each with a status LED and a console button on its left edge. Press
            a guest and the panel becomes that guest.
          </p>
        </div>
        <ThemeCarousel />
      </section>

      <section>
        <div className="sec-head">
          <div className="sec-num">Encoding</div>
          <h2>What the LED and the button mean</h2>
        </div>
        <div className="grid2">
          <LedTable />
          <ConsoleTable />
        </div>
      </section>

      <section>
        <div className="sec-head">
          <div className="sec-num">Shape of it</div>
          <h2>Built to be cheap and safe</h2>
        </div>
        <div className="grid2">
          <ul className="notes">
            <li>
              <b>One poll.</b> <code>/cluster/resources</code> every 10s for the list
              and the LEDs; per-guest <code>/status/current</code> only for the guest
              on screen, so the panel costs one request while it is closed.
            </li>
            <li>
              <b>Keyboard-first.</b> <code>j/k</code> move, <code>l</code> or Enter
              descends, <code>h</code> or Escape comes back and restores the cursor.{" "}
              <code>/</code> searches name, vmid, node or OS.
            </li>
            <li>
              <b>Needs attention is absent when nothing is wrong,</b> so its presence is
              the signal. Alerts name the guest, because a count of broken things is not
              actionable.
            </li>
            <li>
              <b>Status without hue.</b> LEDs use form and brightness rather than
              colour, so they read fine in monochrome themes.
            </li>
          </ul>
          <ul className="notes">
            <li>
              <b>Auth is an API token,</b> <code>PVEAPIToken=user@pve!omarchy=…</code>,
              with <code>VM.Audit</code>, <code>Sys.Audit</code> and{" "}
              <code>Datastore.Audit</code> only. A token that cannot stop a VM cannot
              stop a VM by accident. Written to curl's stdin as a config file, never
              into argv.
            </li>
            <li>
              <b>The read-only boundary is the point.</b> No start, stop, reboot,
              migrate, snapshot or config write — Proxmox's own web UI is better at all
              of those, and it is one keypress away on <code>o</code>.
            </li>
            <li>
              <b>No passwords in config.</b> RDP credentials live in your login keyring,
              asked for once and verified before they are saved; SSH consoles offer a
              one-time key install and store nothing.
            </li>
            <li>
              <b>Console commands live in settings,</b> not in code, so the terminal,
              the SSH user and the <code>xfreerdp3</code> flags are yours to set per
              install.
            </li>
          </ul>
        </div>
      </section>

      <footer>
        <span>omaprox — read-only Proxmox VE for the Omarchy bar</span>
        <a href="https://github.com/AndresSM415/omaprox">github.com/AndresSM415/omaprox</a>
        <span>MIT · not affiliated with Proxmox Server Solutions GmbH</span>
        <span style={{ marginLeft: "auto" }}>figures shown are a sample cluster</span>
      </footer>
    </div>
  );
}
