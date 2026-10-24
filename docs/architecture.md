# Architecture

This document describes the contracts behind Sentinel Autonomy Lab. The short version: **the simulation is the product; the browser is a view.** `src/core` is deterministic and renderer-free, `src/render` is a Three.js adapter, and `src/ui` is a React operations surface over a throttled snapshot.

## 1. Design goals

1. **Transferable autonomy principles.** Fixed-rate sensors, estimator/controller separation, saturation-aware control, explicit failsafes, deterministic scenarios.
2. **No truth leakage.** Guidance, planning and control consume estimates. Ground truth is restricted to the sensor simulator and renderer/evaluation.
3. **Independent testability.** The core must run under Node with no WebGL, DOM or React.
4. **Visual credibility.** A real 3D environment, an FPV feed, a tactical map and an operator console that expose the internal state rather than hiding it.
5. **Honest fidelity.** Simplified elements are stated in the README and in code comments instead of being presented as a high-fidelity digital twin.

## 2. Frames, units and conventions

- World frame: `+X = east`, `+Y = up`, `+Z = south`.
- SI units throughout: metres, seconds, radians, newtons, newton-metres, watts.
- Altitude `y` is MSL/arena zero; AGL is `y - groundHeight`.
- Yaw is a right-handed rotation about `+Y`. At yaw `0`, the aircraft faces north (`-Z`).
- Compass heading is the display convention: `heading° = normalize(-yaw°)`, so north = 000°, east = 090°.
- Body frame matches the rendered airframe: `+X right`, `+Y up`, `+Z back`; body forward is `-Z`.
- Roll is about body `Z`, pitch about body `X`, yaw about body `Y`. `quatToEuler` implements this convention.

This is a deliberate choice: it avoids a coordinate conversion layer between physics and Three.js while retaining unambiguous flight-display angles. The conventions are unit-tested.

## 3. Timing

`SIM_DT = 1/240 s`. The UI step loop is an accumulator; rendering never drives physics directly.

| Subsystem | Rate | Notes |
|---|---:|---|
| Rigid-body dynamics | 240 Hz | Semi-implicit Euler, stable at this step |
| Motor dynamics | 240 Hz | First-order lag, per motor |
| IMU sample | 240 Hz | Bias + random walk + white noise |
| Attitude filter | 240 Hz | Gyro propagation, gated aiding |
| Target tracker predict | 120 Hz | Constant-velocity propagation |
| Navigation filter | 100 Hz | IMU propagation + GNSS/baro updates |
| Flight controller | 100 Hz | Zero-order hold between updates |
| EO detection | 30 Hz | Pixel/range noise and occlusion |
| Barometer | 20 Hz | Altitude-only update |
| GNSS | 8 Hz | Position update |
| Mission/planner | 10 Hz | Replanning and state machine |
| Map/wind | 60 Hz | OU gust update |

The runtime caps catch-up to 48 core steps per animation frame to avoid the classic spiral of death after a tab stall. The diagnostics `advance()` method exists only under `import.meta.env.DEV` for deterministic visual QA.

## 4. Truth boundary

```
SensorSuite (truth + noise) ─┐
                             ├─► measurements ─► Estimators ─► Autonomy ─► Controller ─► actuators
GroundTarget / Quadrotor ────┘                                  │
                                                                └─► mission telemetry
Renderer ────────────────────────────── SimulationSnapshot ◄────── (truth included for visuals)
```

`Simulation` owns the only mutable ground truth. The autonomy system receives:

- `NavigationEstimate` (position, velocity, attitude estimate, covariance),
- `TargetTrack` (target estimate, covariance, status),
- battery percentage,
- on-ground / crashed flags,
- a static `World` map for obstacle lookups.

It does **not** receive `target.state.position`, `drone.state.position`, or the target route. The renderer and HUD may display ground truth for debugging; those fields are named `targetTruth` in the snapshot.

## 5. Flight dynamics

`Quadrotor` is a 6-DOF rigid body with an X-configuration mixer.

- Rotor thrust: `T_i = kT * ω_i²`.
- Motor lag: `ω̇ = (ω_target - ω) / τ_motor`.
- Allocation: a 4×4 matrix maps `[T_collective, τ_x, τ_y, τ_z]` to the four rotor thrusts. The inverse is validated at construction.
- Body torque is recomputed from the actual (post-saturation) rotor thrusts; the mixer therefore reports the torque it can physically produce rather than the torque requested.
- Drag: `F_d = -c_d |v_air| v_air`, with `v_air = v - wind`.
- Angular dynamics include `ω × Iω` and linear angular damping.
- Battery: simple power model with voltage sag; reduces available motor speed and eventually triggers failsafes.

Important parameters are exported in `DEFAULT_DRONE_PARAMETERS`: mass 2.35 kg, arm 0.255 m, inertia `[0.032, 0.055, 0.041]`, `kT = 1.15e-5`, `ω_max = 980 rad/s`, motor time constant 45 ms, 111 Wh battery.

The model omits blade flapping, ground effect, motor electrical transients, ESC latency, and structural flexibility.

## 6. Control

`FlightController` is a cascade:

1. **Position loop (P):** `v_des = clamp(kp_p · (p_des - p) + v_ff, v_max)`.
2. **Velocity loop (PI):** `a_des = kp_v · (v_des - v) + ki_v ∫(v_des - v) + a_ff`, with axis limits.
3. **Thrust vector:** `F_des = m(a_des + g)`, clipped to the tilt limit.
4. **Attitude loop (P):** shortest-arc quaternion error to a desired orientation constructed from the force direction and yaw command; body-rate setpoint is limited.
5. **Body-rate loop (PI + damping):** torque command with per-axis saturation.
6. **Mixer:** collective thrust + torque → motor targets.

The controller is fed the estimated state, not the truth state, so estimator errors propagate into control exactly as they would on a real aircraft. Thrust is projected onto the current body-up axis to respect the physical thrust direction during large tilts.

## 7. Navigation and target estimation

### Navigation filter

Six states `[px, py, pz, vx, vy, vz]`. IMU specific force is rotated into the world frame and used as acceleration input. GNSS updates position with a 3×6 observation matrix; barometer updates the altitude component. Covariance updates use the Joseph form for numerical stability.

Position/velocity uncertainty is exposed for the UI and for future gating logic. The filter is intentionally not a 15-state attitude/velocity/position estimator.

### AHRS

`AttitudeEstimator` integrates gyro measurements. Accelerometer and magnetometer corrections are gated:

- accelerometer correction only in quasi-static flight, with translational acceleration supplied by the navigation filter,
- magnetometer heading correction only near level, away from aggressive angular rates.

This avoids the classic “thrust acceleration observed as gravity” error during banked flight. The limitation is that long-duration attitude accuracy depends on gyro quality; a production stack should use a full EKF with GNSS-velocity aiding.

### Target tracker

Constant-velocity 6-state filter `[px, py, pz, vx, vy, vz]` in world coordinates. Measurements are laser-ranged target positions. Gates reject outliers; velocity is capped at 36 m/s; track status is based on time since update and consecutive measurements. Confidence is derived from covariance and coast time.

## 8. Perception

`TargetDetector` uses a gimballed, world-stabilized camera:

- 1280×720, 38° horizontal FOV,
- gimbal slew limits and rate smoothing,
- ray projection from camera to target, FOV gate,
- exact visibility test against boxes and tree cylinders,
- range + bearing noise, 3.5% laser dropout,
- normalized screen coordinates for the FPV overlay.

The detector returns a world point only when visible; the tracker is not updated on occluded frames. The simulation continues to predict through short occlusions, then transitions to `COASTING` and `LOST`.

## 9. Local planning

The planner is a sampling MPC:

- 9 heading offsets, 3 speed fractions, 3 vertical options, plus hover = **82 candidates**.
- 2.0 s rollout at 0.25 s resolution.
- Scoring combines velocity tracking (`2.6×`), goal distance (`0.22×`), progress, clearance penalties, smoothness, altitude error, idle penalty and line-of-sight penalty.
- Preferred velocity is target velocity plus a bounded closing term; this is essential for following a moving goal. Scoring only the endpoint distance makes a follower “arrive” where the target was, then lag.
- Current clearance determines a braking-speed cap; the planner slows before obstacles rather than relying on emergency braking.
- Hard minimum clearance and a filtered-command re-check are enforced.
- `EMERGENCY` mode generates an escape velocity if clearance drops below 3 m.

The plan is converted into a short waypoint and velocity feed-forward. The controller remains responsible for producing feasible dynamics.

The planner uses the static map. In a real deployment this would be replaced or augmented by LiDAR/depth-based local mapping and a safety monitor.

## 10. Mission and failsafes

States: `TAKEOFF → ACQUIRE → TRACK → LOST → RTH → LAND → COMPLETE`, plus `FAILED`.

- `ACQUIRE` holds while the camera searches the operator cue.
- `TRACK` selects a valid standoff viewpoint and runs the planner.
- `LOST` performs an expanding orbit around the last known estimate; after 22 s it returns home.
- Battery `< 21%` in tracking triggers return-to-home; `< 9%` forces descent.
- Geofence breach triggers return-to-home.
- Collision or ground impact over 4.5 m/s disarms and marks `FAILED`.
- `COMPLETE` disarms after landing.

All transitions produce event-log entries; the operator console renders them in reverse chronological order.

## 11. Rendering and UI

`SimulationView`:

- builds the environment from `ScenarioDefinition` (terrain, road ribbon, buildings, instanced trees, props, helipad, lighting, sky, mountains, clouds),
- renders the scene with a chase/orbit/top-down camera,
- renders a second low-resolution EO pass from the gimbal,
- draws a 2D FPV overlay with brackets and status,
- updates planned path, target estimate, standoff ring, sensor frustum, laser, flight trail and drone halo.

The host aircraft is on render layer 2. The main camera sees layer 2; the FPV camera does not, so the payload view is not occluded by the airframe. The shadow camera also sees layer 2, preserving the drone's shadow in the main view.

React receives `SimulationSnapshot` at 15 Hz via `SimulationRuntime`. The snapshot is immutable data; rendering uses Three.js objects updated from it. This avoids coupling component lifecycle to the 240 Hz loop.

## 12. Determinism and tests

Randomness is seeded in `Rng` (mulberry32) and owned by the scenario. No `Math.random` is used in the core. Two `Simulation` instances constructed with the same scenario follow the same state trajectory; the determinism test compares position and target state after 12 s.

The test suite covers:

- vector/quaternion/matrix conventions,
- route and obstacle geometry,
- target tracker convergence and coast-to-lost behaviour,
- sensor-clean hover,
- closed-loop 60 s missions in all three scenarios,
- deterministic replay.

## 13. Extension points

- **New scenario**: add a `ScenarioDefinition` in `src/core/world/scenarios.ts`; the renderer builds it automatically.
- **New vehicle**: parameterize `DroneParameters` and the mixer; the controller gains are separable.
- **New sensor**: add a model in `sensors.ts`, schedule it in `Simulation.step`, and add an update path to the appropriate estimator.
- **New planner**: implement the `PlannerInput/Output` contract in `planner.ts` (or a sibling) and swap it into the mission; the controller interface is unchanged.
- **SITL bridge**: publish `NavigationEstimate` / `TargetTrack` over MAVLink or ROS 2 and consume actuator setpoints; the core can also be moved to a worker without changing the renderer contract.
- **Learned detection**: replace `TargetDetector.detect` with a model adapter that produces a bearing/range measurement and covariance; the tracker interface stays the same.

## 14. Known limitations

- Flat collidable ground; visual hills/mountains are non-collidable.
- Known static obstacle map; no SLAM, no dynamic obstacle prediction.
- Simplified aerodynamics and actuator model.
- Gyro-primary AHRS rather than a full 15-state EKF.
- Geometric detector rather than a learned model; no lens distortion or motion blur.
- Main-thread simulation and rendering; suitable for an interactive lab, not for high-rate reinforcement learning.
- No hardware latency, clock drift, packet loss or radio-link model.
