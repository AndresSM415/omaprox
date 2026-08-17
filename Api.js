// Request building and response parsing for the Proxmox VE API. Pure functions
// only — Service.qml owns everything mutable and calls in here for strings.

// ---------------------------------------------------------------- credentials

// The token file is a few `key = value` lines. It is parsed rather than
// required in a fixed order because the natural thing to paste out of the
// Proxmox token dialog is the id and the secret, in whichever order they
// happen to land on the clipboard.
//
// Recognised forms:
//   token   = user@realm!name=uuid      the whole thing on one line
//   tokenid = user@realm!name           id and secret split across two
//   secret  = uuid
//   host    = https://pve01.lan:8006    optional, overrides the setting
//
// A bare `user@realm!name=uuid` line with no key also works, because that is
// exactly what Proxmox prints when the token is created.
function parseCredentials(text) {
  var out = { token: "", host: "", error: "" };
  var id = "";
  var secret = "";
  var lines = String(text || "").split("\n");

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line === "" || line.charAt(0) === "#") continue;

    // A whole token on its own line: user@realm!name=uuid
    var bare = line.match(/^([^\s=@]+@[^\s=@!]+![^\s=]+)=(\S+)$/);
    if (bare) {
      id = bare[1];
      secret = bare[2];
      continue;
    }

    var pair = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*[:=]\s*(.*)$/);
    if (!pair) continue;
    var key = pair[1].toLowerCase().replace(/[_-]/g, "");
    var value = pair[2].trim().replace(/^["']|["']$/g, "");
    if (value === "") continue;

    if (key === "token" || key === "apitoken" || key === "pveapitoken") {
      // Tolerate the PVEAPIToken= prefix being pasted along with the value.
      out.token = value.replace(/^PVEAPIToken\s*=\s*/i, "");
    } else if (key === "tokenid" || key === "id" || key === "user") {
      id = value;
    } else if (key === "secret" || key === "tokensecret" || key === "value") {
      secret = value;
    } else if (key === "host" || key === "url" || key === "server") {
      out.host = value;
    }
  }

  if (out.token === "" && id !== "" && secret !== "")
    out.token = id + "=" + secret;
  if (out.token !== "" && out.token.indexOf("!") < 0)
    out.error =
      "the token is missing its !name part — expected user@realm!name=uuid";
  return out;
}

// ---------------------------------------------------------------- addressing

// Proxmox is https on 8006 unless told otherwise, and everyone writes the host
// without either. Filling both in means `pve01.lan` is a valid setting.
function normalizeHost(host) {
  var h = String(host || "").trim();
  if (h === "") return "";
  h = h.replace(/\s+/g, "");
  if (!/^https?:\/\//i.test(h)) h = "https://" + h;
  h = h.replace(/\/+$/, "");
  // Port detection has to survive IPv6 literals, where the colons inside the
  // brackets are part of the address rather than a port.
  var authority = h.replace(/^https?:\/\//i, "");
  if (!/:\d+$/.test(authority)) h += ":8006";
  return h;
}

function apiBase(host) {
  return normalizeHost(host) + "/api2/json";
}

// The host with the scheme and port stripped — what you would hand to ssh.
// Unlike hostLabel this keeps the domain, because this one has to resolve.
function hostAuthority(host) {
  return normalizeHost(host)
    .replace(/^https?:\/\//i, "")
    .replace(/:\d+$/, "");
}

// The bare hostname, for the panel title. `pve01` reads as the name of the
// thing you are looking at; `https://pve01.lan:8006` reads as a config value
// that leaked into the UI.
//
// Only a name gets shortened to its first label. An address has no
// less-qualified form — trimming 10.0.20.2 at the first dot leaves "10", which
// is not the name of anything.
function hostLabel(host) {
  var h = normalizeHost(host)
    .replace(/^https?:\/\//i, "")
    .replace(/:\d+$/, "");
  if (/^\d+(\.\d+){3}$/.test(h)) return h; // IPv4
  if (h.indexOf("[") === 0 || h.indexOf(":") >= 0) return h; // IPv6
  var dot = h.indexOf(".");
  return dot > 0 ? h.slice(0, dot) : h;
}

// One call covers every node and every guest on the cluster, which is why the
// poll is a single request however many nodes there are.
function clusterResourcesUrl(host) {
  return apiBase(host) + "/cluster/resources";
}
// Only fetched for the node whose detail view is open. The cluster call
// already carries cpu/mem/disk, so this exists purely for what it adds: load
// average, swap, IO delay, and the kernel and PVE versions.
function nodeStatusUrl(host, node) {
  return apiBase(host) + "/nodes/" + encodeURIComponent(node) + "/status";
}
function guestStatusUrl(host, node, vtype, vmid) {
  return (
    apiBase(host) +
    "/nodes/" +
    encodeURIComponent(node) +
    "/" +
    vtype +
    "/" +
    vmid +
    "/status/current"
  );
}
function guestConfigUrl(host, node, vtype, vmid) {
  return (
    apiBase(host) +
    "/nodes/" +
    encodeURIComponent(node) +
    "/" +
    vtype +
    "/" +
    vmid +
    "/config"
  );
}
// The one endpoint that needs VM.Monitor rather than VM.Audit, which is why it
// sits behind a setting that is off by default.
function agentInterfacesUrl(host, node, vmid) {
  return (
    apiBase(host) +
    "/nodes/" +
    encodeURIComponent(node) +
    "/qemu/" +
    vmid +
    "/agent/network-get-interfaces"
  );
}

// The web UI's deep link for one guest. Proxmox encodes the tree selection in
// the fragment; everything after the type/vmid pair is positional state the UI
// fills in itself.
function webUiGuestUrl(host, vtype, vmid) {
  return normalizeHost(host) + "/#v1:0:=" + vtype + "%2F" + vmid;
}
function webUiNodeUrl(host, node) {
  return normalizeHost(host) + "/#v1:0:=node%2F" + encodeURIComponent(node);
}

// ---------------------------------------------------------------- transport

// curl config text for `curl -K -`. Only the token travels this way: argv is
// world-readable through /proc/<pid>/cmdline, and an
// `-H "Authorization: PVEAPIToken=…"` argument would hand the secret to every
// process on the machine.
//
// Boolean options are bare words in a curl config — `insecure = true` is
// rejected as trailing garbage and kills the whole request.
function curlConfig(token, url, options) {
  var opts = options || {};
  var lines = [
    "silent",
    "show-error",
    "max-time = 20",
    'header = "Authorization: PVEAPIToken=' + token + '"',
    'header = "Accept: application/json"',
  ];
  // An explicit CA always wins: someone who went to the trouble of pointing at
  // one means to verify against it, whatever the verify setting says.
  if (opts.caCert) lines.push('cacert = "' + opts.caCert + '"');
  else if (!opts.verifyTls) lines.push("insecure");
  // The status code is appended on its own line because Proxmox answers 401
  // with a body that is either empty or indistinguishable from a successful
  // one, so the body alone cannot tell a rejected token from an empty cluster.
  lines.push('write-out = "\\n%{http_code}"');
  lines.push('url = "' + url + '"');
  return lines.join("\n") + "\n";
}

function curlGet() {
  return ["curl", "-K", "-"];
}

// Splits the trailing status line off, then unwraps Proxmox's {data: …}.
// Returns one uniform shape so callers never branch on transport failure
// versus HTTP failure versus application failure.
function parseResponse(text) {
  var raw = String(text || "");
  var status = 0;
  var body = raw;

  var cut = raw.lastIndexOf("\n");
  if (cut >= 0) {
    var tail = raw.slice(cut + 1).trim();
    if (/^\d{3}$/.test(tail)) {
      status = parseInt(tail, 10);
      body = raw.slice(0, cut);
    }
  }

  var parsed = null;
  var trimmed = body.trim();
  if (trimmed !== "") {
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      parsed = null;
    }
  }

  if (status === 401 || status === 403) {
    return {
      ok: false,
      auth: true,
      status: status,
      data: null,
      error:
        status === 401
          ? "the API token was rejected"
          : "the API token lacks permission for this",
    };
  }

  if (status >= 400 || (status === 0 && parsed === null)) {
    var message = "";
    if (parsed && parsed.errors) {
      for (var key in parsed.errors) {
        message = key + ": " + parsed.errors[key];
        break;
      }
    }
    if (!message && parsed && parsed.message) message = String(parsed.message);
    if (!message && status > 0) message = "HTTP " + status;
    if (!message)
      message = trimmed === "" ? "empty response" : "unparseable response";
    return {
      ok: false,
      auth: false,
      status: status,
      data: null,
      error: message,
    };
  }

  if (parsed === null)
    return {
      ok: false,
      auth: false,
      status: status,
      data: null,
      error: "unparseable response",
    };

  return {
    ok: true,
    auth: false,
    status: status,
    data: parsed.data,
    error: "",
  };
}

// ---------------------------------------------------------------- guest config

// Everything the panel wants out of a guest's config, normalized across the
// two guest types. Proxmox reports the same idea under different keys for LXC
// and QEMU, and the panel should not have to know which it is looking at.
function readConfig(vtype, raw) {
  var config = raw || {};
  var ostype = String(config.ostype || "");
  var out = {
    ostype: ostype,
    // QEMU ostypes for Windows are all w-prefixed: wxp, w2k, w2k3, w2k8,
    // wvista, win7, win8, win10, win11. Linux is l24/l26, and everything else
    // is solaris or other. LXC ostypes are distro names and never Windows.
    windows: vtype === "qemu" && /^w/.test(ostype),
    osLabel: osLabel(vtype, ostype),
    onboot: String(config.onboot || "0") === "1",
    cores: Number(config.cores) || 0,
    sockets: Number(config.sockets) || 1,
    memoryMb: Number(config.memory) || 0,
    unprivileged: String(config.unprivileged || "0") === "1",
    features: String(config.features || ""),
    agent:
      vtype === "qemu" && /(^|,)(1|enabled=1)/.test(String(config.agent || "")),
    description: String(config.description || ""),
    address: "",
  };

  // A container's address is in its own config, which costs nothing extra to
  // read. A VM's is not, which is the whole reason the agent setting exists.
  if (vtype === "lxc") {
    for (var key in config) {
      if (!/^net\d+$/.test(key)) continue;
      var ip = String(config[key]).match(/(?:^|,)ip=([^,\/]+)/);
      if (ip && ip[1] && ip[1] !== "dhcp" && ip[1] !== "manual") {
        out.address = ip[1];
        break;
      }
    }
  }

  return out;
}

function osLabel(vtype, ostype) {
  var t = String(ostype || "");
  if (t === "") return vtype === "lxc" ? "container" : "vm";
  var windows = {
    win11: "Windows 11",
    win10: "Windows 10",
    win8: "Windows 8",
    win7: "Windows 7",
    wvista: "Windows Vista",
    wxp: "Windows XP",
    w2k: "Windows 2000",
    w2k3: "Windows Server 2003",
    w2k8: "Windows Server 2008",
  };
  if (windows[t]) return windows[t];
  if (t === "l26" || t === "l24") return "Linux";
  if (t === "solaris") return "Solaris";
  if (t === "other") return "Other";
  // LXC reports the distro directly: debian, ubuntu, alpine, archlinux, …
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// First routable address the agent reports. Loopback and link-local are
// skipped because neither is somewhere you can open a session to.
function readAgentAddress(raw) {
  var interfaces = raw && Array.isArray(raw.result) ? raw.result : [];
  for (var i = 0; i < interfaces.length; i++) {
    var name = String(interfaces[i]["name"] || "");
    if (name === "lo") continue;
    var addresses = Array.isArray(interfaces[i]["ip-addresses"])
      ? interfaces[i]["ip-addresses"]
      : [];
    for (var a = 0; a < addresses.length; a++) {
      var ip = String(addresses[a]["ip-address"] || "");
      if (ip === "" || ip.indexOf("127.") === 0 || ip.indexOf("169.254.") === 0)
        continue;
      if (ip === "::1" || ip.toLowerCase().indexOf("fe80") === 0) continue;
      return ip;
    }
  }
  return "";
}

// ---------------------------------------------------------------- console

// Where a console session should point. In priority order: an explicit
// override, then whatever the guest itself told us, then the guest's name —
// which is a working hostname on any network with sane DNS, and a clearer
// failure than an empty string when it is not.
function consoleAddress(guest, config, agentAddress, overrides) {
  var override = overrides ? overrides[String(guest.vmid)] : "";
  if (override) return String(override);
  if (config && config.address) return String(config.address);
  if (agentAddress) return String(agentAddress);
  return String(guest.name || "");
}

// These are what a hand-written override would look like, and what the README
// documents. The plugin routes its *own* defaults through bin/omaprox-ssh
// instead, which is the same command plus a one-time offer to install an SSH
// key so the password stops being asked for. Setting either of these in
// shell.json opts out of that and runs exactly what you wrote.
var DEFAULT_LXC_CONSOLE = "ssh -t {nodeUser}@{node} pct enter {vmid}";
var DEFAULT_VM_CONSOLE = "ssh -t {guestUser}@{address}";
var DEFAULT_RDP_CONSOLE =
  "xfreerdp3 /v:{address} /dynamic-resolution +clipboard";
// Used instead of the above when an rdpUser is configured. There is no
// password equivalent and there will not be one: a password in shell.json is a
// password in every backup and paste of that file. FreeRDP prompts for it on
// the terminal the console opens in, which is the right place to type one.
var DEFAULT_RDP_CONSOLE_USER =
  "xfreerdp3 /v:{address} /u:{rdpUser} /dynamic-resolution +clipboard";

// Placeholders are substituted, not shell-interpolated: the values come from
// the Proxmox API and a template the user wrote, and a guest named
// `; rm -rf ~` should stay a string. Anything that is not a known placeholder
// is left alone so the rest of the command keeps working.
//
// `{host}` exists because `{node}` is a Proxmox node *name*, and a node name
// is only a hostname if something on the network resolves it. Plenty of
// single-node setups reach Proxmox by address and have no DNS entry for
// `pve` at all, which makes the default container console fail with a name
// lookup error rather than anything that points at the cause.
function renderCommand(template, values) {
  return String(template || "").replace(
    /\{(vmid|name|node|host|address|nodeUser|guestUser|rdpUser)\}/g,
    function (match, key) {
      var value = values[key];
      return value === undefined || value === null
        ? ""
        : shellQuote(String(value));
    },
  );
}

// Single-quote for POSIX shells, closing and reopening around embedded quotes.
function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}
