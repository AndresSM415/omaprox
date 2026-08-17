// The demo bar, laid out after the author's own Omarchy bar so the showcase
// reads as a real desktop rather than a generic one. Widgets are reduced to
// small stroke glyphs; the Omaprox widget is the "active" one.

const G = {
  menu: [
    "M8 1.6 14 4.6 8 7.6 2 4.6 8 1.6Z",
    "M2 8 8 11 14 8",
    "M2 11.4 8 14.4 14 11.4",
  ],
  indicators: ["M3 8h2.5M7 8h2M10.5 8H13"],
  update: [
    "M8 2.8v3.2M8 6 5.6 3.6M8 6l2.4-2.4",
    "M3.2 8a5 5 0 0 1 9.6 0",
  ],
  weather: [
    "M3.5 11.5h9a3 3 0 0 0 0-6 4 4 0 0 0-7.5 1.2A2.5 2.5 0 0 0 3.5 11.5Z",
    "M6 13.5h5",
  ],
  cloudflare: [
    "M4 12.5a3 3 0 0 1 0-6 4 4 0 0 1 7.7-1.2 2.5 2.5 0 0 1 .3 5A2.5 2.5 0 0 1 12 12.5Z",
  ],
  nearby: ["M2 8l6-5 6 5", "M8 3v4.5", "M4.5 6v5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V6"],
  dropbox: ["M8 2.2 14 6l-6 4-6-4 8-3.8Z", "M2 10.2l6 3.8 6-3.8-6-3.8-6 3.8Z"],
  tray: ["M2.5 5.5h11", "M5.5 5.5V9", "M10.5 5.5V9", "M3.5 13h9"],
  tailscale: ["M3 8h10", "M8 3v10", "M5.5 5.5 10.5 10.5", "M10.5 5.5 5.5 10.5"],
  bluetooth: ["M8.5 2.8 4.5 5.8 8 8.5 4.5 10.5 8.5 13.2", "M8 2.8v2.4M8 13.2v-2.4"],
  agents: [
    "M8 2.5l1 2.7 2.7 1-2.7 1-1 2.7-1-2.7-2.7-1 2.7-1 1-2.7Z",
    "M12.5 10l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6.6-1.5Z",
  ],
  network: ["M2 11c0-3.3 2.7-6 6-6s6 2.7 6 6", "M5 13.5a4 4 0 0 1 6 0"],
  audio: ["M4.5 6v4a3.5 3.5 0 0 0 7 0V6a3.5 3.5 0 0 0-7 0Z", "M8 2.5v3.5", "M2.5 7.5v1M13.5 7.5v1"],
  monitor: ["M2.5 4h11v7h-11z", "M6 14h4M8 11v3"],
  power: ["M8 2.5v6", "M4 5.5a5 5 0 1 0 8 0"],
};

function Glyph({ name, size = 13 }) {
  const paths = G[name] || [];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {paths.map((d, i) => (
        <path key={i} d={d} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

function Widget({ icon, label, active = false, children }) {
  return (
    <span className={`bar-item${active ? " active" : ""}`}>
      {icon && <Glyph name={icon} />}
      {label && <span className="bar-label">{label}</span>}
      {children}
    </span>
  );
}

export default function DemoBar() {
  return (
    <div className="bar">
      <div className="left">
        <Widget icon="menu" />
        <span className="ws" aria-label="workspaces">
          <i className="on" />
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>

      <div className="center">
        <Widget icon="indicators" />
        <Widget label="Mon 17 Aug 13:42" />
        <Widget label="US" />
        <Widget icon="update" />
        <Widget icon="weather" />
      </div>

      <div className="right">
        <Widget icon="cloudflare" />
        <Widget icon="nearby" />
        <Widget icon="dropbox" />
        <Widget icon="tray" />
        <Widget active>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 1.6 14 4.6 8 7.6 2 4.6 8 1.6Z" style={{ stroke: "var(--accent)" }} strokeWidth="1.1" strokeLinejoin="round" />
            <path d="M2 8 8 11 14 8" style={{ stroke: "var(--accent)" }} strokeWidth="1.1" strokeLinejoin="round" opacity=".8" />
            <path d="M2 11.4 8 14.4 14 11.4" style={{ stroke: "var(--accent)" }} strokeWidth="1.1" strokeLinejoin="round" opacity=".5" />
          </svg>
          <span className="bar-count">9</span>
        </Widget>
        <Widget icon="tailscale" />
        <Widget icon="bluetooth" />
        <Widget icon="agents" />
        <Widget icon="network" />
        <Widget icon="audio" />
        <Widget icon="monitor" />
        <Widget icon="power" />
      </div>
    </div>
  );
}
