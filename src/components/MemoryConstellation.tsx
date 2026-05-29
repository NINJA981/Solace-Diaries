import React, { useRef, useEffect } from 'react';

interface Node {
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

export default function MemoryConstellation() {
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

    // Initialize 3D particles
    const nodes: Node[] = [];
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

    // Mouse events
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.targetX = e.clientX - rect.left;
      mouseRef.current.targetY = e.clientY - rect.top;
    };

    const handleMouseLeave = () => {
      mouseRef.current.targetX = -1000;
      mouseRef.current.targetY = -1000;
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    // Render loop
    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Smooth mouse movement
      const mouse = mouseRef.current;
      mouse.x += (mouse.targetX - mouse.x) * 0.1;
      mouse.y += (mouse.targetY - mouse.y) * 0.1;

      // Update & Draw Nodes
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

        // Project 3D coordinates to 2D
        const fov = 250; // field of view
        const scale = fov / (fov + node.z);
        const projX = (node.x - width / 2) * scale + width / 2;
        const projY = (node.y - height / 2) * scale + height / 2;
        const size = node.baseRadius * scale;

        // Animate pulse
        node.pulsePhase += node.pulseSpeed;
        const currentGlow = node.glow + Math.sin(node.pulsePhase) * 4;

        // Render Connections
        nodes.forEach((other) => {
          if (node === other) return;
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const dz = node.z - other.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist < 120) {
            const opacity = (1 - dist / 120) * 0.15 * scale;
            ctx.beginPath();
            ctx.moveTo(projX, projY);
            
            const otherScale = fov / (fov + other.z);
            const otherProjX = (other.x - width / 2) * otherScale + width / 2;
            const otherProjY = (other.y - height / 2) * otherScale + height / 2;

            ctx.lineTo(otherProjX, otherProjY);
            ctx.strokeStyle = `rgba(173, 169, 186, ${opacity})`;
            ctx.lineWidth = 0.5 * scale;
            ctx.stroke();
          }
        });

        // Draw outer glass halo if hovered
        let isHovered = false;
        if (mouse.x > 0 && mouse.y > 0) {
          const dx = mouse.x - projX;
          const dy = mouse.y - projY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 20) {
            isHovered = true;
            ctx.beginPath();
            ctx.arc(projX, projY, size * 3, 0, Math.PI * 2);
            ctx.fillStyle = node.color.replace('0.7', '0.15');
            ctx.strokeStyle = node.color.replace('0.7', '0.4');
            ctx.lineWidth = 1;
            ctx.fill();
            ctx.stroke();
          }
        }

        // Draw Glow Core
        ctx.beginPath();
        ctx.arc(projX, projY, size, 0, Math.PI * 2);
        
        ctx.shadowBlur = currentGlow;
        ctx.shadowColor = node.color;
        ctx.fillStyle = isHovered ? '#FFFFFF' : node.color;
        ctx.fill();
        ctx.shadowBlur = 0; // reset shadow

        // Render labels for prominent nodes
        if (node.label && scale > 1.05) {
          ctx.font = `italic 300 ${Math.max(9, Math.round(10 * scale))}px var(--font-serif)`;
          ctx.fillStyle = `rgba(231, 231, 236, ${Math.max(0.2, (scale - 0.8) * 0.8)})`;
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
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 z-0 overflow-hidden pointer-events-auto">
      <canvas ref={canvasRef} className="w-full h-full block bg-transparent" />
    </div>
  );
}
