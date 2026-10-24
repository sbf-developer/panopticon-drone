import {
  type Vec3,
  V3,
  add,
  clamp,
  distance,
  horizontal,
  horizontalLength,
  normalize,
  scale,
  sub,
} from '../math/vec3';
import { World, obstacleClearance, type Obstacle } from '../world/environment';

export type PlannerStatus = 'CLEAR' | 'AVOIDING' | 'EMERGENCY' | 'BLOCKED';

export interface PlannerInput {
  position: Vec3;
  velocity: Vec3;
  goal: Vec3;
  goalVelocity?: Vec3;
  targetPoint: Vec3 | null;
  maxSpeed: number;
  minAltitude: number;
}

export interface PlannerOutput {
  waypoint: Vec3;
  velocity: Vec3;
  status: PlannerStatus;
  clearance: number;
  candidateCount: number;
  path: Vec3[];
  goalDistance: number;
}

interface Candidate {
  velocity: Vec3;
  score: number;
  clearance: number;
  end: Vec3;
  path: Vec3[];
}

const SPEED_FRACTIONS = [0.45, 0.72, 1.0] as const;
const HEADING_OFFSETS_DEG = [-90, -60, -35, -15, 0, 15, 35, 60, 90] as const;
const VERTICAL_OPTIONS = [-2.2, 0, 2.4] as const;
const ROLLOUT_STEP = 0.25;
const ROLLOUT_HORIZON = 2.0;
const MIN_CLEARANCE = 2.0;
const SAFETY_MARGIN = 3.0;

/**
 * Sampling-based receding-horizon local planner. It rolls out constant-velocity
 * candidates through the known 2.5-D obstacle map, scores velocity tracking,
 * clearance, target visibility and smoothness, then emits a short look-ahead
 * setpoint for the cascade controller.
 *
 * The velocity-tracking term is important for moving goals: scoring only the
 * endpoint distance makes a follower stop at where the goal was, not where it
 * is going. Here the preferred velocity combines the goal's own velocity with
 * a bounded closing term.
 */
export class LocalPlanner {
  private lastVelocity = V3();
  private lastStatus: PlannerStatus = 'CLEAR';
  private replanCount = 0;
  private lastClearance = 0;
  private lastGoalDistance = 0;
  private lastPath: Vec3[] = [];
  private lastCandidateCount = 0;
  private nearbyCache: { position: Vec3; obstacles: Obstacle[] } | null = null;

  reset(): void {
    this.lastVelocity = V3();
    this.lastStatus = 'CLEAR';
    this.replanCount = 0;
    this.lastClearance = 0;
    this.lastGoalDistance = 0;
    this.lastPath = [];
    this.lastCandidateCount = 0;
    this.nearbyCache = null;
  }

  plan(input: PlannerInput, world: World): PlannerOutput {
    this.replanCount += 1;
    const currentClearance = world.clearance(input.position)?.clearance ?? 99;
    this.lastClearance = currentClearance;
    if (currentClearance < SAFETY_MARGIN) {
      const emergency = this.emergencyVelocity(input.position, world);
      this.lastVelocity = emergency;
      this.lastStatus = 'EMERGENCY';
      this.lastPath = [input.position, add(input.position, scale(emergency, 1.1))];
      this.lastGoalDistance = distance(input.position, input.goal);
      this.lastCandidateCount = 0;
      return {
        waypoint: add(input.position, scale(emergency, 0.35)),
        velocity: scale(emergency, 0.8),
        status: 'EMERGENCY',
        clearance: currentClearance,
        candidateCount: 0,
        path: this.lastPath,
        goalDistance: this.lastGoalDistance,
      };
    }

    const obstacles = this.nearbyObstacles(input.position, input.goal, world);
    const goalDelta = sub(input.goal, input.position);
    const goalHorizontal = horizontal(goalDelta);
    const goalDistanceHorizontal = horizontalLength(goalDelta);
    const dir = goalDistanceHorizontal > 0.25 ? normalize(goalHorizontal) : V3();
    const goalVelocity = horizontal(input.goalVelocity ?? V3());
    const catchUpSpeed = clamp(goalDistanceHorizontal * 0.6, 0, 9);
    const preferredVelocityRaw = add(goalVelocity, scale(dir, catchUpSpeed));
    const brakingSpeed =
      Math.sqrt(2 * 4.2 * Math.max(0, currentClearance - SAFETY_MARGIN)) + 1.5;
    const preferredSpeed = clamp(
      Math.min(horizontalLength(preferredVelocityRaw), input.maxSpeed, brakingSpeed),
      0,
      input.maxSpeed,
    );
    const preferredDirection =
      horizontalLength(preferredVelocityRaw) > 0.3 ? normalize(preferredVelocityRaw) : dir;
    const preferredVelocity = scale(preferredDirection, preferredSpeed);
    const candidateSpeed = Math.max(preferredSpeed, 2.6);
    const candidates: Candidate[] = [];

    for (const angleDeg of HEADING_OFFSETS_DEG) {
      const angle = (angleDeg * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rotated = V3(
        preferredDirection.x * cos + preferredDirection.z * sin,
        0,
        -preferredDirection.x * sin + preferredDirection.z * cos,
      );
      for (const fraction of SPEED_FRACTIONS) {
        for (const vertical of VERTICAL_OPTIONS) {
          const speed = candidateSpeed * fraction;
          const velocity = V3(rotated.x * speed, vertical, rotated.z * speed);
          candidates.push(
            this.evaluateCandidate(
              input,
              velocity,
              obstacles,
              world,
              preferredVelocity,
              goalDistanceHorizontal,
            ),
          );
        }
      }
    }
    // Explicit hover lets the planner station-keep instead of orbiting a goal.
    candidates.push(
      this.evaluateCandidate(
        input,
        V3(),
        obstacles,
        world,
        preferredVelocity,
        goalDistanceHorizontal,
      ),
    );

    let best = candidates[0]!;
    let anySafe = false;
    for (const candidate of candidates) {
      if (candidate.clearance >= MIN_CLEARANCE && Number.isFinite(candidate.score)) {
        anySafe = true;
        if (!Number.isFinite(best.score) || candidate.score < best.score) best = candidate;
      }
    }

    if (!anySafe) {
      this.lastVelocity = V3();
      this.lastStatus = 'BLOCKED';
      this.lastPath = [input.position, add(input.position, V3(0, 1.5, 0))];
      this.lastCandidateCount = candidates.length;
      return {
        waypoint: add(input.position, V3(0, 1.5, 0)),
        velocity: V3(0, 1.8, 0),
        status: 'BLOCKED',
        clearance: currentClearance,
        candidateCount: candidates.length,
        path: this.lastPath,
        goalDistance: distance(input.position, input.goal),
      };
    }

    // Smooth the selected velocity, but only while the smoothed command itself
    // remains collision-free for a short horizon.
    const blend = 0.5;
    let filtered = {
      x: this.lastVelocity.x + (best.velocity.x - this.lastVelocity.x) * blend,
      y: this.lastVelocity.y + (best.velocity.y - this.lastVelocity.y) * blend,
      z: this.lastVelocity.z + (best.velocity.z - this.lastVelocity.z) * blend,
    };
    const filteredClearance = this.rolloutClearance(input.position, filtered, obstacles);
    if (filteredClearance < MIN_CLEARANCE) filtered = best.velocity;
    this.lastVelocity = filtered;

    const speed = Math.hypot(filtered.x, filtered.z);
    const horizontalStep = Math.min(0.25, 6 / Math.max(speed, 1));
    const waypoint = V3(
      input.position.x + filtered.x * horizontalStep,
      input.position.y + clamp(input.goal.y - input.position.y, -4.2, 4.2),
      input.position.z + filtered.z * horizontalStep,
    );
    const feedforward = V3(filtered.x * 0.82, filtered.y * 0.55, filtered.z * 0.82);
    this.lastStatus =
      best.clearance < 7 ||
      distance(best.velocity, preferredVelocity) > Math.max(2.5, preferredSpeed * 0.35)
        ? 'AVOIDING'
        : 'CLEAR';
    this.lastGoalDistance = distance(input.position, input.goal);
    this.lastPath = best.path;
    this.lastCandidateCount = candidates.length;

    return {
      waypoint,
      velocity: feedforward,
      status: this.lastStatus,
      clearance: best.clearance,
      candidateCount: candidates.length,
      path: this.lastPath,
      goalDistance: this.lastGoalDistance,
    };
  }

  get status(): PlannerStatus {
    return this.lastStatus;
  }

  get clearance(): number {
    return this.lastClearance;
  }

  get replans(): number {
    return this.replanCount;
  }

  get goalDistance(): number {
    return this.lastGoalDistance;
  }

  get plannedPath(): Vec3[] {
    return this.lastPath;
  }

  get candidateCount(): number {
    return this.lastCandidateCount;
  }

  private evaluateCandidate(
    input: PlannerInput,
    velocity: Vec3,
    obstacles: readonly Obstacle[],
    world: World,
    preferredVelocity: Vec3,
    currentGoalDistance: number,
  ): Candidate {
    const path: Vec3[] = [input.position];
    let minClearance = Infinity;
    let clearancePenalty = 0;
    let position = input.position;
    const steps = Math.ceil(ROLLOUT_HORIZON / ROLLOUT_STEP);
    for (let step = 1; step <= steps; step += 1) {
      position = add(position, scale(velocity, ROLLOUT_STEP));
      path.push(position);
      if (position.y < 2.2 || !world.inBounds(position)) {
        return {
          velocity,
          score: Number.POSITIVE_INFINITY,
          clearance: -99,
          end: position,
          path,
        };
      }
      for (const obstacle of obstacles) {
        const clearance = obstacleClearance(obstacle, position);
        minClearance = Math.min(minClearance, clearance);
        if (clearance < MIN_CLEARANCE) clearancePenalty += (MIN_CLEARANCE - clearance) * 300;
        else if (clearance < 9) clearancePenalty += (9 - clearance) ** 2 * 1.25;
      }
    }
    if (!Number.isFinite(minClearance)) minClearance = 40;

    const end = path[path.length - 1]!;
    const goalDist = distance(end, input.goal);
    const horizontalGoalDist = Math.hypot(end.x - input.goal.x, end.z - input.goal.z);
    const verticalCost = Math.abs(end.y - input.goal.y) * 0.6;
    const speed = horizontalLength(velocity);
    const smoothness = distance(velocity, this.lastVelocity) * 0.7;
    const altitudePenalty = velocity.y > 0 && end.y > input.goal.y + 4 ? 6 : 0;
    const idlePenalty = speed < 1.2 && currentGoalDistance > 8 ? 12 : 0;
    let visibilityPenalty = 0;
    if (input.targetPoint) {
      if (world.segmentBlocked(end, input.targetPoint, 0.2)) visibilityPenalty = 11;
    }
    const velocityError = distance(
      V3(velocity.x, velocity.y * 0.5, velocity.z),
      V3(preferredVelocity.x, 0, preferredVelocity.z),
    );
    const progress = Math.max(0, currentGoalDistance - horizontalGoalDist);

    return {
      velocity,
      score:
        velocityError * 2.6 +
        goalDist * 0.22 +
        verticalCost +
        clearancePenalty +
        smoothness +
        altitudePenalty +
        idlePenalty +
        visibilityPenalty -
        progress * 0.8,
      clearance: minClearance,
      end,
      path,
    };
  }

  private rolloutClearance(position: Vec3, velocity: Vec3, obstacles: readonly Obstacle[]): number {
    let min = Infinity;
    for (let step = 1; step <= 4; step += 1) {
      const p = add(position, scale(velocity, step * 0.22));
      for (const obstacle of obstacles) min = Math.min(min, obstacleClearance(obstacle, p));
    }
    return Number.isFinite(min) ? min : 40;
  }

  private nearbyObstacles(position: Vec3, goal: Vec3, world: World): Obstacle[] {
    if (this.nearbyCache && distance(this.nearbyCache.position, position) < 2.5) {
      return this.nearbyCache.obstacles;
    }
    const relevant = world.obstacles.filter((obstacle) => {
      const center = V3(obstacle.centerX, 0, obstacle.centerZ);
      return distance(center, position) < 65 || distance(center, goal) < 45;
    });
    this.nearbyCache = { position, obstacles: relevant };
    return relevant;
  }

  private emergencyVelocity(position: Vec3, world: World): Vec3 {
    let nearest: Obstacle | null = null;
    let nearestClearance = Infinity;
    for (const obstacle of world.obstacles) {
      const clearance = obstacleClearance(obstacle, position);
      if (clearance < nearestClearance) {
        nearest = obstacle;
        nearestClearance = clearance;
      }
    }
    if (!nearest) return V3(0, 2.5, 0);
    let away: Vec3;
    if (nearest.kind === 'box') {
      const dx = position.x - nearest.centerX;
      const dz = position.z - nearest.centerZ;
      const ratioX = dx / nearest.halfWidth;
      const ratioZ = dz / nearest.halfDepth;
      away =
        Math.abs(ratioX) > Math.abs(ratioZ)
          ? V3(Math.sign(dx) || 1, 0, 0)
          : V3(0, 0, Math.sign(dz) || 1);
    } else {
      away = normalize(V3(position.x - nearest.centerX, 0, position.z - nearest.centerZ));
    }
    return add(scale(away, 10.5), V3(0, 3.0, 0));
  }
}
