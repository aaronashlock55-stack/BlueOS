# BlueOS 2.0 — Vex-style Motor Setup

> Part of the **BlueOS 2.0** ROV-redesign fork. Companion guide:
> Cockpit's `docs/BlueOS-2.0-Controller-and-Video.md` (controller + video features).
> This document covers the BlueOS onboard-frontend changes only.

## What changed

A new **Motors** tab under **Vehicle Setup** replaces the "click a row in a table"
flow with a VEX-style board: every Navigator PWM output is a clickable card you
assign, spin-test, and name in place.

Branch: `feature/vex-motor-config` · Commit: `81b3210`

## For operators — how to use it

Open **Vehicle Setup → Motors**. You'll see two panels:

| Panel | What it does |
|---|---|
| **Left** — 3D vehicle viewer | Hover any port card to highlight that thruster on the model |
| **Right** — Navigator PWM Outputs | One card per output port (1–16) showing its current assignment |

**Assign a motor to a port**
1. Click a port card → the parameter editor opens.
2. Pick a function (e.g. *Motor 1*). This writes `SERVOn_FUNCTION` to the
   autopilot over the normal MAVLink parameter protocol.

**Confirm the wiring (spin test)**
1. Put the vehicle in **Manual** mode and flip the **arm** switch in the tab header
   to *Armed* (the switch is disabled until the vehicle is in Manual).
2. Click a port's **Spin** button. That thruster pulses for ~1 second at ~10%
   throttle (1600 µs) so you can see/hear which physical motor is on that port.
3. The **Detect Reversed Motors** button (header) runs ArduSub's automatic
   reversal detection, exactly as on the PWM Outputs tab.

> ⚠️ Spin tests move real thrusters. Keep clear of the props; do it in water or
> with props removed.

**Name a motor**
- Type a name in the field on any assigned port card (e.g. "Front-Left").
- Names are stored **on the vehicle** (BlueOS bag-of-holding key-value service,
  key `blueos-2-0/motor-config`), so they follow the vehicle, not the browser.
- Named motors are summarised on the **Overview** tab in a new **Motors** card
  as `Output N — Name (Motor M)`.

## For developers

| Concern | Location |
|---|---|
| Motors tab UI | `core/frontend/src/components/vehiclesetup/MotorConfig.vue` |
| Tab registration | `core/frontend/src/views/VehicleSetupView.vue` (new `Motors` page) |
| Name persistence helper | `core/frontend/src/components/vehiclesetup/motor-names.ts` |
| Overview summary card | `core/frontend/src/components/vehiclesetup/overview/MotorsInfo.vue` |

**Key design decisions**
- **No new transport.** Port assignment reuses the existing
  `ServoFunctionEditorDialog` + `autopilot_data.parameterRegex(...)` plumbing.
  Motor outputs map to ArduPilot `SERVOn_FUNCTION` params.
- **Arm/spin logic** mirrors the proven `PwmSetup.vue` pattern (heartbeat
  `base_mode` bits for armed/manual state; `doMotorTest()` for the pulse) rather
  than inventing new state.
- **Names live in the BlueOS key-value store**, not ArduPilot (ArduPilot params
  have no name field). `loadMotorNames()` / `saveMotorNames()` wrap the `bag` store.

**Run it (no hardware needed for layout):**
```bash
cd core/frontend
yarn install      # first time
yarn dev          # http://localhost:8080  → Vehicle Setup → Motors
```
The Motors tab needs a backend **with a vehicle** to populate (the ports come
from `SERVOn_FUNCTION` params), so a bare `yarn dev` shows "backend offline" and
a loading spinner. To preview it with **no rover**, point the dev server at a
BlueOS backend running a **SITL** (simulated) autopilot — see
`docs/BlueOS-2.0-SITL-Dev.md`.

## Hardware verification checklist (Navigator + ArduSub)

- [ ] Assigning a port spins the **correct** physical thruster on Spin
- [ ] Custom names persist across a page reload (stored on the vehicle)
- [ ] Assignments appear in `ParameterEditorView` as the matching `SERVOn_FUNCTION`
- [ ] Overview → Motors card lists named motors correctly
