// Celebration confetti — a self-contained canvas burst (no libraries), fired
// when a writing sprint finishes. Motion-safe: skipped entirely when the
// user prefers reduced motion.

interface Particle {
	x: number; y: number;
	vx: number; vy: number;
	w: number; h: number;
	color: string;
	rot: number; vrot: number;
	life: number; // 1 → 0
}

const COLORS = ['#7DBB7D', '#E8C547', '#E89B3C', '#D95555', '#6E8FC9', '#9B8AC4'];
const GRAVITY = 0.16;
const DRAG = 0.992;
const LIFE_DECAY = 0.0075;

/**
 * Fire a fireworks-style confetti explosion over the whole window.
 * Two staggered bursts from the lower third, ~3 seconds total.
 */
export function launchConfetti(): void {
	if (activeWindow.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

	const canvas = activeDocument.body.createEl('canvas', { cls: 'sg-confetti-canvas' });
	// Size, timers and animation frames all come from the canvas's own window,
	// so the confetti fits a popout window and keeps animating there.
	const win = canvas.win;
	const ctx = canvas.getContext('2d');
	if (!ctx) { canvas.remove(); return; }
	const dpr = win.devicePixelRatio || 1;
	canvas.width = win.innerWidth * dpr;
	canvas.height = win.innerHeight * dpr;
	ctx.scale(dpr, dpr);

	const particles: Particle[] = [];
	const burst = (cx: number, cy: number, count: number) => {
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * Math.PI * 2;
			const speed = 3 + Math.random() * 8.5;
			particles.push({
				x: cx, y: cy,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed - 2.5,
				w: 5 + Math.random() * 5,
				h: 3 + Math.random() * 4,
				color: COLORS[Math.floor(Math.random() * COLORS.length)],
				rot: Math.random() * Math.PI,
				vrot: (Math.random() - 0.5) * 0.3,
				life: 1,
			});
		}
	};

	const W = win.innerWidth;
	const H = win.innerHeight;
	burst(W * (0.3 + Math.random() * 0.15), H * 0.62, 110);
	win.setTimeout(() => burst(W * (0.6 + Math.random() * 0.15), H * 0.55, 110), 280);

	let raf = 0;
	const tick = () => {
		ctx.clearRect(0, 0, W, H);
		let alive = 0;
		for (const p of particles) {
			if (p.life <= 0) continue;
			alive++;
			p.vx *= DRAG;
			p.vy = p.vy * DRAG + GRAVITY;
			p.x += p.vx;
			p.y += p.vy;
			p.rot += p.vrot;
			p.life -= LIFE_DECAY;
			ctx.save();
			ctx.globalAlpha = Math.max(0, p.life);
			ctx.translate(p.x, p.y);
			ctx.rotate(p.rot);
			ctx.fillStyle = p.color;
			ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
			ctx.restore();
		}
		if (alive > 0) raf = win.requestAnimationFrame(tick);
		else canvas.remove();
	};
	raf = win.requestAnimationFrame(tick);

	// Hard stop after 4s no matter what (tab switch pauses rAF etc.).
	win.setTimeout(() => {
		win.cancelAnimationFrame(raf);
		canvas.remove();
	}, 4000);
}
