# homebridge-eufy-robovac-matter

A [Homebridge](https://homebridge.io) 2.x plugin that exposes a **Eufy RoboVac**
as a **native Matter Robotic Vacuum Cleaner** device.

Classic HomeKit (HAP) has no vacuum type, so the usual integrations have to fake
a robot as a fan or a switch. This plugin instead publishes the robot through
Homebridge 2's Matter support (`api.matter`), so in the Home app it appears as a
real **robot vacuum tile** with **start / pause / return‑to‑dock**, **clean
mode**, **operational state**, **battery**, and — on supported models — **Find
the robot** and **per‑room (Service Area)** cleaning.

> **Unofficial / community plugin.** Not affiliated with, authorised by, or
> supported by Anker, eufy, or Tuya. It talks to the same APIs the eufy app
> uses; those are not public and may change at any time.

## Two control backends

| Backend | Use for | Needs |
| ------- | ------- | ----- |
| **Cloud** (recommended for current models) | Newer "novel"‑protocol robots such as the **Eufy Clean L60**, which don't speak the legacy local protocol | Your eufy email + password, and the device ID (internet required) |
| **Local (Tuya LAN)** | Older/legacy RoboVacs (G/C‑series etc.) | `deviceId` + `localKey` (no cloud, no internet) |

Most robots sold in the last few years need the **cloud** backend. If you're not
sure, start with cloud. The backend is chosen per device in the config.

## Requirements

- **Homebridge 2.0+** (the `api.matter` API ships in Homebridge 2.0) on **Node 20+**.
- **Matter enabled** on the Homebridge instance (or child bridge) running this
  plugin — see [Matter setup](#matter-setup).
- A **Matter controller**: Apple Home (**iOS 18.4+** is required for robot
  vacuums), Amazon Alexa, Google Home, Home Assistant, SmartThings, etc.
- The robot and Homebridge on the **same local network**, with working
  IPv6/mDNS on that subnet (Matter needs it).

## Installation

### Homebridge UI (recommended)

In the Homebridge UI, open **Plugins**, search for
`homebridge-eufy-clean-robovac-matter` (or just "eufy robovac matter"), and click
**Install**. Then configure it from the form it provides and restart Homebridge
when prompted.

### Command line

On the machine running Homebridge:

```bash
sudo npm install -g homebridge-eufy-clean-robovac-matter
```

Restart Homebridge afterwards. The plugin and its settings form then appear in
the Homebridge UI under **Plugins**, where you can configure it like any other
plugin.

### Updating

Update from the Homebridge UI's **Plugins** page, or on the command line:

```bash
sudo npm install -g homebridge-eufy-clean-robovac-matter@latest
```

To run an unreleased version from source instead, see
[Building from source](#building-from-source).

## Getting your credentials

### Cloud backend

You need your **eufy account email + password** and the robot's **device ID**.
The easiest way to get the device ID is the
[eufy-clean-local-key-grabber](https://github.com/Rjevski/eufy-clean-local-key-grabber),
which lists your devices and their IDs (it also prints the local key, which the
cloud backend doesn't need).

### Local backend

Older models need the Tuya **device ID** and **local key**, obtained with the
same [eufy-clean-local-key-grabber](https://github.com/Rjevski/eufy-clean-local-key-grabber).
Setting a static **IP** for the robot is optional but recommended.

## Configuration

Add the platform via the Homebridge UI (recommended — it renders a form from the
plugin's config schema), or edit `config.json` directly. Each device uses either
the **cloud** or the **local** backend.

**Cloud backend** (novel models such as the L60):

```json
{
  "platform": "EufyRobovacMatter",
  "name": "Eufy RoboVac (Matter)",
  "devices": [
    {
      "name": "L60",
      "backend": "cloud",
      "deviceId": "xxxxxxxxxxxxxxxxxxxx",
      "email": "you@example.com",
      "password": "your-eufy-password",
      "mop": true
    }
  ]
}
```

**Local backend** (older/legacy models):

```json
{
  "platform": "EufyRobovacMatter",
  "name": "Eufy RoboVac (Matter)",
  "devices": [
    {
      "name": "Living Room RoboVac",
      "backend": "local",
      "deviceId": "xxxxxxxxxxxxxxxxxxxx",
      "localKey": "xxxxxxxxxxxxxxxx",
      "deviceIp": "192.168.1.50",
      "protocolVersion": "3.3"
    }
  ]
}
```

| Field      | Backend | Required | Description                                             |
| ---------- | ------- | -------- | ------------------------------------------------------- |
| `name`     | both    | yes      | Name shown for the robot in your Matter/Home app.       |
| `backend`  | both    | no       | `auto` (default), `local`, or `cloud`. `auto` picks local when a `localKey` is set, otherwise cloud. |
| `deviceId` | both    | yes      | Tuya/eufy device ID.                                    |
| `email`    | cloud   | yes\*    | Eufy account email (\*required for cloud).              |
| `password` | cloud   | yes\*    | Eufy account password (\*required for cloud).           |
| `mop`      | cloud   | no       | `true` for Hybrid models — exposes Vacuum/Mop/Vacuum & Mop clean modes. |
| `rooms`    | cloud   | no       | List of `{ "id": <room id>, "name": "..." }` for Apple Home room selection (Service Area). See [Rooms](#rooms-service-area). |
| `mapId`    | cloud   | no       | Map the rooms belong to (usually leave blank).          |
| `localKey` | local   | yes\*    | Tuya local key (\*required for local).                  |
| `deviceIp` | local   | no       | Static IP of the robot (improves local performance).    |
| `protocolVersion` | local | no | Tuya LAN protocol version (`3.3` default, or `3.4` / `3.5` / `3.1`). |

### Rooms (Service Area)

Apple Home (iOS 18.4+) can show **per‑room selection** for Matter vacuums. The
eufy cloud doesn't expose the robot's room list (the map, including room names,
is streamed over a proprietary P2P channel the plugin can't read), so you define
the rooms yourself:

```json
{
  "name": "L60", "backend": "cloud", "deviceId": "…", "email": "…", "password": "…",
  "mop": true,
  "rooms": [ { "id": 1, "name": "Living Room" }, { "id": 2, "name": "Kitchen" } ]
}
```

Selecting rooms in Home and starting a clean sends the robot a room‑clean for
those ids; with none selected it does a full clean. The `id` must match the
robot's **map room id**.

On a **fresh install** the plugin seeds three editable placeholders
(`Room 1`–`Room 3`, ids `1`–`3`) into the device config automatically, so they
appear in the settings UI and Apple Home's Service Area straight away. Later
restarts **never overwrite** your edits — once the `rooms` key exists (even if
you empty it), the plugin leaves it alone. To discover the real ids, clean each
placeholder from Home to see which room it runs, then rename it — and add or
remove rows — to match your robot's rooms.

## Matter setup

This plugin publishes **Matter** devices only — it registers nothing over HAP.
You must enable Matter on the bridge running it. The recommended setup is a
**child bridge** for this plugin with Matter turned on:

1. In the Homebridge UI, open this plugin's **Bridge Settings** and run it as a
   **child bridge**.
2. Enable **Matter** for that child bridge.
3. Restart Homebridge. A Matter pairing code is shown in the Homebridge logs / UI
   for the child bridge.
4. In Apple Home (or your controller), choose **Add Accessory** and scan/enter
   that pairing code. The RoboVac appears as a robot vacuum.

Each robot vacuum is published as its own external Matter device, so it pairs and
appears independently.

## How Eufy state maps to Matter

| Matter cluster          | Behaviour                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| **RvcRunMode**          | `Cleaning` → start cleaning; `Idle` → return to dock.                                       |
| **RvcOperationalState** | `pause` / `resume` / `goHome`; reports Running, Paused, Seeking charger, Charging, Docked, Error. |
| **RvcCleanMode**        | Suction level (`Standard` / `Turbo` / `Max`), or Vacuum / Mop / Vacuum & Mop on `mop` models. |
| **PowerSource**         | Battery percentage and charge state.                                                        |
| **Identify**            | "Find the robot" (where the model supports it).                                             |
| **ServiceArea**         | Per‑room selection (see [Rooms](#rooms-service-area)).                                      |

> Not every model exposes every feature; the plugin advertises only what the
> robot reports and degrades gracefully otherwise. Note that **Apple Home
> doesn't surface clean‑mode selection** for vacuums — other Matter controllers
> (Alexa, Home Assistant, SmartThings) do.

## Troubleshooting

**Cloud: "logged in too many times today" (USER_SESSION_LIMIT).** The eufy cloud
caps daily logins. The plugin persists its session between restarts to avoid
this; if you hit it, wait and it clears — a healthy start logs
`Resumed saved Tuya cloud session (no login needed)`.

**Local: connects but every command times out.** If the log shows
`Connected to device!` then `Timeout waiting for status response`, the TCP
connection is fine but the robot can't decode the requests — almost always a
**protocol version** or **localKey** mismatch:

1. Set `protocolVersion` to **`3.4`**, restart, and test. If still timing out, try **`3.5`**.
2. If no version works, your **`localKey` is likely stale** (it rotates whenever the robot is
   re-added in the eufy app). Re-grab it and update the config.
3. Make sure nothing else holds the single local connection — close the eufy app and stop any
   other local Tuya integration polling the robot.

**Device doesn't appear in Apple Home.** Confirm Matter is enabled on the
(child) bridge, you're on iOS 18.4+, and IPv6/mDNS works on your network.

## Building from source

To build the plugin yourself (e.g. to run an unreleased commit):

```bash
git clone https://github.com/peterrussell/homebridge-eufy-robovac-matter.git
cd homebridge-eufy-robovac-matter
npm install
npm run build
```

The compiled output goes to `dist/` (which is committed, so a plain install
needs no build). To use a local checkout with Homebridge, install it by path —
`sudo npm install -g .` from the checkout — then restart Homebridge. Runtime
dependencies are kept minimal: only `protobufjs` and `tuyapi`; everything else
uses Node's built‑in `fetch`/`crypto`.

## Credits & license

- **Matter integration** uses Homebridge 2's `api.matter` plugin API.
- **Local Tuya control** is ported from
  [@hov3rcraft/homebridge-eufy-robovac](https://github.com/hov3rcraft/homebridge-eufy-robovac)
  (itself a rewrite of the original by apexad).
- **Cloud (novel) protocol** — the eufy/Tuya‑cloud login, the novel DPS map, the
  protobuf command/state definitions and the error codes are a self‑contained
  port of [martijnpoppen/eufy-clean](https://github.com/martijnpoppen/eufy-clean)
  (MIT), reimplemented here with Node's built‑in `fetch`/`crypto` and
  `protobufjs` rather than depending on that library.

MIT
