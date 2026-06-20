import React, { useRef, useEffect } from 'react';
import { API_BASE } from '../api';

interface MemoryConstellationProps {
  token?: string;
}

interface GraphNode {
  id: string;
  name: string;
  type: string;
}

interface GraphLink {
  id: string;
  source: string;
  target: string;
  type: string;
  strength: number;
}

interface Node {
  id?: string;
  x: number;
  y: number;
  z: number; // depth
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  baseRadius: number;
  label: string;
  color: string;
  glow: number;
  pulseSpeed: number;
  pulsePhase: number;
}

const MEMORY_LABELS = [
  'Reflections', 'Gratitude', 'Self-Care', 'Relationships', 'Ambition', 
  'Milestone', 'Mindfulness', 'Life Lessons', 'Cozy Nights', 'Dreams',
  'Creativity', 'Overcoming', 'Insights', 'Peaceful Moments', 'Growth'
];

const COLORS = [
  'rgba(139, 92, 246, 0.7)', // violet
  'rgba(99, 102, 241, 0.7)', // indigo
  'rgba(59, 130, 246, 0.7)', // blue
  'rgba(236, 72, 153, 0.7)', // pink
  'rgba(244, 63, 94, 0.7)',  // rose
];

export default function MemoryConstellation({ token }: MemoryConstellationProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mouseRef = useRef({ x: -1000, y: -1000, targetX: -1000, targetY: -1000, radius: 150 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = canvas.width = canvas.offsetWidth;
    let height = canvas.height = canvas.offsetHeight;

    // Resize handler
    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };
    window.addEventListener('resize', handleResize);

    // Initialize particle arrays
    const nodes: Node[] = [];
    let links: { sourceIndex: number; targetIndex: number; strength: number; type: string }[] = [];

    // Mouse events
    const mouse = mouseRef.current;
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.targetX = e.clientX - rect.left;
      mouse.targetY = e.clientY - rect.top;
    };

    const handleMouseLeave = () => {
      mouse.targetX = -1000;
      mouse.targetY = -1000;
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    const initializeStaticNodes = () => {
      const numNodes = 28;
      for (let i = 0; i < numNodes; i++) {
        const baseRadius = Math.random() * 3 + 2;
        const label = i < MEMORY_LABELS.length ? MEMORY_LABELS[i] : '';
        nodes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          z: Math.random() * 200 - 100, // Depth between -100 and 100
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          vz: (Math.random() - 0.5) * 0.3,
          radius: baseRadius,
          baseRadius,
          label,
          color: COLORS[i % COLORS.length],
          glow: Math.random() * 10 + 5,
          pulseSpeed: 0.02 + Math.random() * 0.03,
          pulsePhase: Math.random() * Math.PI * 2
        });
      }
    };

    // Fetch dynamic graph data
    const fetchGraphData = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/memories/graph`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to fetch graph');
        const data: { nodes: GraphNode[]; links: GraphLink[] } = await res.json();

        if (data.nodes && data.nodes.length > 0) {
          // Initialize nodes dynamically from actual graph data
          data.nodes.forEach((gn, i) => {
            const baseRadius = Math.random() * 3 + 3; // slightly larger for user nodes
            let color = COLORS[i % COLORS.length];
            // Color code by entity type!
            if (gn.type === 'emotions') {
              color = 'rgba(236, 72, 153, 0.8)'; // Pink/Rose for emotions
            } else if (gn.type === 'habits') {
              color = 'rgba(139, 92, 246, 0.8)'; // Violet/Purple for habits
            } else if (gn.type === 'projects' || gn.type === 'goals') {
              color = 'rgba(59, 130, 246, 0.8)'; // Blue/Indigo for projects
            } else if (gn.type === 'places') {
              color = 'rgba(16, 185, 129, 0.8)'; // Emerald/Green for places
            } else if (gn.type === 'people') {
              color = 'rgba(245, 158, 11, 0.8)'; // Amber/Yellow for people
            }

            nodes.push({
              id: gn.id,
              x: Math.random() * width,
              y: Math.random() * height,
              z: Math.random() * 200 - 100,
              vx: (Math.random() - 0.5) * 0.3,
              vy: (Math.random() - 0.5) * 0.3,
              vz: (Math.random() - 0.5) * 0.2,
              radius: baseRadius,
              baseRadius,
              label: gn.name,
              color,
              glow: Math.random() * 12 + 6,
              pulseSpeed: 0.01 + Math.random() * 0.02,
              pulsePhase: Math.random() * Math.PI * 2
            });
          });

          // Map links
          data.links.forEach((gl) => {
            const sourceIndex = nodes.findIndex((n) => n.id === gl.source);
            const targetIndex = nodes.findIndex((n) => n.id === gl.target);
            if (sourceIndex !== -1 && targetIndex !== -1) {
              links.push({
                sourceIndex,
                targetIndex,
                strength: gl.strength,
                type: gl.type
              });
            }
          });
        } else {
          // Fallback to static labels if empty
          initializeStaticNodes();
        }
      } catch (err) {
        console.error('Failed to load dynamic constellation graph:', err);
        initializeStaticNodes();
      }
    };

    if (token) {
      fetchGraphData();
    } else {
      initializeStaticNodes();
    }

    // Render loop
    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Smooth mouse movement
      mouse.x += (mouse.targetX - mouse.x) * 0.1;
      mouse.y += (mouse.targetY - mouse.y) * 0.1;

      // Update Node positions first
      nodes.forEach((node) => {
        // Move
        node.x += node.vx;
        node.y += node.vy;
        node.z += node.vz;

        // Bounce inside 3D bounds
        if (node.x < 0 || node.x > width) node.vx *= -1;
        if (node.y < 0 || node.y > height) node.vy *= -1;
        if (node.z < -100 || node.z > 100) node.vz *= -1;

        // Mouse interaction (gravity attraction)
        if (mouse.x > 0 && mouse.y > 0) {
          const dx = mouse.x - node.x;
          const dy = mouse.y - node.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < mouse.radius) {
            const force = (mouse.radius - dist) / mouse.radius;
            node.x -= (dx / dist) * force * 0.8;
            node.y -= (dy / dist) * force * 0.8;
          }
        }
      });

      const fov = 250;
      const isLight = document.body.classList.contains('light');

      // 1. Draw connections
      if (links.length > 0) {
        links.forEach((link) => {
          const node = nodes[link.sourceIndex];
          const other = nodes[link.targetIndex];
          if (!node || !other) return;

          const scale = fov / (fov + node.z);
          const otherScale = fov / (fov + other.z);

          const projX = (node.x - width / 2) * scale + width / 2;
          const projY = (node.y - height / 2) * scale + height / 2;
          const otherProjX = (other.x - width / 2) * otherScale + width / 2;
          const otherProjY = (other.y - height / 2) * otherScale + height / 2;

          ctx.beginPath();
          ctx.moveTo(projX, projY);
          ctx.lineTo(otherProjX, otherProjY);

          const baseOpacity = Math.min(0.1 + link.strength * 0.08, 0.7);
          const opacity = baseOpacity * ((scale + otherScale) / 2);

          ctx.strokeStyle = isLight
            ? `rgba(96, 85, 76, ${opacity * 1.5})`
            : `rgba(173, 169, 186, ${opacity})`;
          ctx.lineWidth = Math.min(0.5 + link.strength * 0.4, 3.0) * ((scale + otherScale) / 2);
          ctx.stroke();

          // Render type text in middle
          if (((scale + otherScale) / 2) > 1.05) {
            const midX = (projX + otherProjX) / 2;
            const midY = (projY + otherProjY) / 2;
            ctx.font = `italic 300 ${Math.max(7, Math.round(8 * ((scale + otherScale) / 2)))}px var(--font-serif)`;
            ctx.fillStyle = isLight
              ? `rgba(44, 38, 33, 0.45)`
              : `rgba(231, 231, 236, 0.4)`;
            ctx.textAlign = 'center';
            ctx.fillText(link.type, midX, midY - 4);
          }
        });
      } else {
        // Fallback distance connections
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          const scale = fov / (fov + node.z);
          const projX = (node.x - width / 2) * scale + width / 2;
          const projY = (node.y - height / 2) * scale + height / 2;

          for (let j = i + 1; j < nodes.length; j++) {
            const other = nodes[j];
            const dx = node.x - other.x;
            const dy = node.y - other.y;
            const dz = node.z - other.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist < 120) {
              const otherScale = fov / (fov + other.z);
              const otherProjX = (other.x - width / 2) * otherScale + width / 2;
              const otherProjY = (other.y - height / 2) * otherScale + height / 2;

              const opacity = (1 - dist / 120) * 0.15 * ((scale + otherScale) / 2);
              ctx.beginPath();
              ctx.moveTo(projX, projY);
              ctx.lineTo(otherProjX, otherProjY);

              ctx.strokeStyle = isLight
                ? `rgba(96, 85, 76, ${opacity * 1.5})`
                : `rgba(173, 169, 186, ${opacity})`;
              ctx.lineWidth = 0.5 * ((scale + otherScale) / 2);
              ctx.stroke();
            }
          }
        }
      }

      // 2. Draw nodes on top
      nodes.forEach((node) => {
        const scale = fov / (fov + node.z);
        const projX = (node.x - width / 2) * scale + width / 2;
        const projY = (node.y - height / 2) * scale + height / 2;
        const size = node.baseRadius * scale;

        node.pulsePhase += node.pulseSpeed;
        const currentGlow = node.glow + Math.sin(node.pulsePhase) * 4;

        let isHovered = false;
        if (mouse.x > 0 && mouse.y > 0) {
          const dx = mouse.x - projX;
          const dy = mouse.y - projY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 20) {
            isHovered = true;
            ctx.beginPath();
            ctx.arc(projX, projY, size * 3, 0, Math.PI * 2);
            ctx.fillStyle = node.color.replace('0.7', '0.15').replace('0.8', '0.15');
            ctx.strokeStyle = node.color.replace('0.7', '0.4').replace('0.8', '0.4');
            ctx.lineWidth = 1;
            ctx.fill();
            ctx.stroke();
          }
        }

        ctx.beginPath();
        ctx.arc(projX, projY, size, 0, Math.PI * 2);
        
        ctx.shadowBlur = currentGlow;
        ctx.shadowColor = node.color;
        ctx.fillStyle = isHovered ? (isLight ? '#2C2621' : '#FFFFFF') : node.color;
        ctx.fill();
        ctx.shadowBlur = 0; // reset shadow

        if (node.label && scale > 0.8) {
          ctx.font = `italic 300 ${Math.max(9, Math.round(11 * scale))}px var(--font-serif)`;
          ctx.fillStyle = isLight
            ? `rgba(44, 38, 33, ${Math.max(0.4, (scale - 0.6) * 0.95)})`
            : `rgba(231, 231, 236, ${Math.max(0.3, (scale - 0.6) * 0.9)})`;
          ctx.textAlign = 'center';
          ctx.fillText(node.label, projX, projY - size - 8);
        }
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, [token]);

  return (
    <div ref={containerRef} className="absolute inset-0 z-0 overflow-hidden pointer-events-auto">
      <canvas ref={canvasRef} className="w-full h-full block bg-transparent" />
    </div>
  );
}
