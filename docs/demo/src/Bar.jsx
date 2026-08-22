// The demo bar, trimmed to the author's own Omarchy bar so the showcase
// reads as a real desktop rather than a generic one. Widgets are reduced to
// small stroke glyphs; the Omaprox widget is the "active" one.

const G = {
  menu: [
    "M8 1.6 14 4.6 8 7.6 2 4.6 8 1.6Z",
    "M2 8 8 11 14 8",
    "M2 11.4 8 14.4 14 11.4",
  ],
  weather: [
    "M3.5 11.5h9a3 3 0 0 0 0-6 4 4 0 0 0-7.5 1.2A2.5 2.5 0 0 0 3.5 11.5Z",
    "M6 13.5h5",
  ],
  claude: [
    "M8 1.5v2.6M8 11.9v2.6M1.5 8h2.6M11.9 8h2.6M3.4 3.4l1.9 1.9M10.7 10.7l1.9 1.9M12.6 3.4l-1.9 1.9M5.3 10.7l-1.9 1.9",
  ],
  wifi: [
    "M2 9.5c0-3.6 2.7-6.5 6-6.5s6 2.9 6 6.5",
    "M4.6 12a5 5 0 0 1 6.8 0",
    "M8 14.5h.01",
  ],
  headphones: [
    "M3 11V9a5 5 0 0 1 10 0v2",
    "M3 11v3a1.2 1.2 0 0 0 1.2 1.2h.6",
    "M13 11v3a1.2 1.2 0 0 1-1.2 1.2h-.6",
  ],
  monitor: ["M2.5 4h11v7h-11z", "M6 14h4M8 11v3"],
  power: ["M8 2.5v6", "M4 5.5a5 5 0 1 0 8 0"],
};

function Glyph({ name, size = 13 }) {
  const paths = G[name] || [];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
        <Widget label="Mon 17 Aug 13:42" />
        <Widget icon="weather" />
      </div>

      <div className="right">
        <Widget active>
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M8 1.6 14 4.6 8 7.6 2 4.6 8 1.6Z"
              style={{ stroke: "var(--accent)" }}
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
            <path
              d="M2 8 8 11 14 8"
              style={{ stroke: "var(--accent)" }}
              strokeWidth="1.1"
              strokeLinejoin="round"
              opacity=".8"
            />
            <path
              d="M2 11.4 8 14.4 14 11.4"
              style={{ stroke: "var(--accent)" }}
              strokeWidth="1.1"
              strokeLinejoin="round"
              opacity=".5"
            />
          </svg>
          <span className="bar-count">8</span>
        </Widget>
        <Widget icon="claude" />
        <Widget icon="wifi" />
        <Widget icon="headphones" />
        <Widget icon="monitor" />
        <Widget icon="power" />
      </div>
    </div>
  );
}
