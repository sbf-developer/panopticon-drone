import { useEffect, useRef } from 'react';
import type { ScenarioDefinition } from '../../core/world/types';
import type { SimulationSnapshot } from '../../core/sim/snapshot';

interface MiniMapProps {
  scenario: ScenarioDefinition;
  snapshot: SimulationSnapshot;
}

export const MiniMap = ({ scenario, snapshot }: MiniMapProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trailRef = useRef<Array<{ x: number; z: number }>>([]);
  const lastScenario = useRef(scenario.id);

  useEffect(() => {
    if (lastScenario.current !== scenario.id) {
      trailRef.current = [];
      lastScenario.current = scenario.id;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssWidth = canvas.parentElement?.clientWidth ?? 280;
    const cssHeight = 160;
    if (canvas.width !== Math.floor(cssWidth * dpr) || canvas.height !== Math.floor(cssHeight * dpr)) {
      canvas.width = Math.floor(cssWidth * dpr);
      canvas.height = Math.floor(cssHeight * dpr);
      canvas.style.width = '100%';
      canvas.style.height = `${cssHeight}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const width = cssWidth;
    const height = cssHeight;
    ctx.clearRect(0, 0, width, height);

    const bounds = { minX: -190, maxX: 190, minZ: -160, maxZ: 160 };
    const scale = Math.min(width / (bounds.maxX - bounds.minX), height / (bounds.maxZ - bounds.minZ));
    const offsetX = width / 2;
    const offsetY = height / 2;
    const px = (x: number): number => offsetX + x * scale;
    const pz = (z: number): number => offsetY + z * scale;

    ctx.fillStyle = '#0c0e12';
    ctx.fillRect(0, 0, width, height);
    // Tactical grid.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.055)';
    ctx.lineWidth = 1;
    for (let x = -160; x <= 160; x += 40) {
      ctx.beginPath();
      ctx.moveTo(px(x), 0);
      ctx.lineTo(px(x), height);
      ctx.stroke();
    }
    for (let z = -120; z <= 120; z += 40) {
      ctx.beginPath();
      ctx.moveTo(0, pz(z));
      ctx.lineTo(width, pz(z));
      ctx.stroke();
    }

    // Buildings.
    scenario.buildings.forEach((building) => {
      ctx.fillStyle = 'rgba(84, 105, 112, 0.54)';
      ctx.strokeStyle = 'rgba(160, 184, 188, 0.35)';
      ctx.lineWidth = 0.7;
      const w = building.width * scale;
      const d = building.depth * scale;
      ctx.fillRect(px(building.x) - w / 2, pz(building.z) - d / 2, w, d);
      ctx.strokeRect(px(building.x) - w / 2, pz(building.z) - d / 2, w, d);
    });

    // Trees, intentionally faint.
    ctx.fillStyle = 'rgba(57, 84, 60, 0.5)';
    for (const tree of scenario.trees) {
      ctx.beginPath();
      ctx.arc(px(tree.x), pz(tree.z), 1.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Route.
    ctx.strokeStyle = 'rgba(214, 197, 153, 0.56)';
    ctx.lineWidth = Math.max(2.5, scenario.roadWidth * scale * 0.9);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    scenario.route.forEach((point, index) => {
      if (index === 0) ctx.moveTo(px(point.x), pz(point.z));
      else ctx.lineTo(px(point.x), pz(point.z));
    });
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(26, 32, 31, 0.9)';
    ctx.lineWidth = Math.max(1, scenario.roadWidth * scale * 0.55);
    ctx.stroke();

    // Flight trail.
    const trail = trailRef.current;
    const pos = snapshot.drone.position;
    if (trail.length === 0 || Math.hypot(trail[trail.length - 1]!.x - pos.x, trail[trail.length - 1]!.z - pos.z) > 2) {
      trail.push({ x: pos.x, z: pos.z });
      if (trail.length > 120) trail.shift();
    }
    ctx.strokeStyle = 'rgba(111, 227, 242, 0.42)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    trail.forEach((point, index) => {
      if (index === 0) ctx.moveTo(px(point.x), pz(point.z));
      else ctx.lineTo(px(point.x), pz(point.z));
    });
    ctx.stroke();

    // Home.
    ctx.strokeStyle = 'rgba(126, 240, 178, 0.75)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(px(scenario.drone.home.x), pz(scenario.drone.home.z), 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(126, 240, 178, 0.8)';
    ctx.fillRect(px(scenario.drone.home.x), pz(scenario.drone.home.z) - 7, 1, 14);
    ctx.fillRect(px(scenario.drone.home.x) - 7, pz(scenario.drone.home.z), 14, 1);

    // Target truth faint, estimated track bright.
    const truth = snapshot.targetTruth.position;
    ctx.fillStyle = 'rgba(255, 140, 95, 0.35)';
    ctx.beginPath();
    ctx.arc(px(truth.x), pz(truth.z), 4.5, 0, Math.PI * 2);
    ctx.fill();
    if (snapshot.perception.trackInitialized) {
      const track = snapshot.perception.trackPosition;
      ctx.strokeStyle = 'rgba(255, 179, 101, 0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px(track.x), pz(track.z), 6.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#f6b26b';
      ctx.beginPath();
      ctx.arc(px(track.x), pz(track.z), 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Drone heading triangle.
    const heading = snapshot.drone.heading * (Math.PI / 180);
    ctx.save();
    ctx.translate(px(pos.x), pz(pos.z));
    ctx.rotate(heading);
    ctx.fillStyle = '#8de1b4';
    ctx.shadowColor = '#8de1b4';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // North marker / scale.
    ctx.fillStyle = 'rgba(206, 223, 226, 0.75)';
    ctx.font = '600 8px "JetBrains Mono", monospace';
    ctx.fillText('N', width - 16, 14);
    ctx.strokeStyle = 'rgba(206, 223, 226, 0.5)';
    ctx.beginPath();
    ctx.moveTo(width - 12, 20);
    ctx.lineTo(width - 12, 34);
    ctx.moveTo(width - 15, 24);
    ctx.lineTo(width - 12, 20);
    ctx.lineTo(width - 9, 24);
    ctx.stroke();
    ctx.fillStyle = 'rgba(154, 176, 181, 0.65)';
    ctx.fillText('50 m', 10, height - 9);
    ctx.strokeStyle = 'rgba(154, 176, 181, 0.5)';
    ctx.beginPath();
    ctx.moveTo(10, height - 18);
    ctx.lineTo(10 + 50 * scale, height - 18);
    ctx.stroke();
  }, [scenario, snapshot]);

  return (
    <div className="minimap">
      <canvas ref={canvasRef} />
      <div className="minimap__corner minimap__corner--tl" />
      <div className="minimap__corner minimap__corner--br" />
    </div>
  );
};
