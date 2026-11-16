// Двойная спираль ДНК на canvas.
// Движение — равномерный рост фазы синусоиды: x(s) = A · sin(k·s + φ). Нити идут в противофазе,
// поэтому плетение выглядит как медленное вращение молекулы вокруг оси. Кадр зависит только
// от φ по модулю 2π, так что цикл замыкается без склейки.

const TAU = Math.PI * 2;
const SHADES = 8;
const BACK_RGB = [184, 199, 167];
const FRONT_RGB = [129, 155, 114];
const SAMPLE_STEP_PX = 5;
const PITCH_TO_AMPLITUDE = 3.4;
const STATIC_PHASE = 0.95;
const PARALLAX_PX = 14;
const BEAD_PERIOD_MS = 3600;

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const smallScreen = matchMedia('(max-width: 639px)');

const shadeColors = Array.from({ length: SHADES }, (_, index) => {
  const t = index / (SHADES - 1);
  const channel = (i) => Math.round(BACK_RGB[i] + (FRONT_RGB[i] - BACK_RGB[i]) * t);
  return `rgb(${channel(0)} ${channel(1)} ${channel(2)})`;
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

const shadeOf = (depth) => clamp(Math.floor(((depth + 1) / 2) * SHADES), 0, SHADES - 1);

// Узлы-подписи стоят на оси в центрах ячеек равномерной сетки (в CSS это --key-grid и --at).
// Число перекладин берётся кратным сетке с нечётным множителем: тогда центр перекладины совпадает с каждым узлом.
function pickRungCount(turns, keyGrid) {
  const perCell = (turns * 5.5) / keyGrid;
  const oddMultiplier = Math.max(1, 2 * Math.round((perCell - 1) / 2) + 1);
  return keyGrid * oddMultiplier;
}

function mountHelix(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const radiansPerMs = TAU / (Number(root.dataset.period) * 1000);

  let geometry = null;
  let sin = new Float32Array(0);
  let cos = new Float32Array(0);
  let phase = STATIC_PHASE;
  let clock = 0;
  let scrollBoost = 0;
  let lastTime = 0;
  let lastScrollY = 0;
  let frame = 0;
  let shift = 0;
  let onScreen = false;

  function measure() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const vertical = height > width;
    const length = vertical ? height : width;
    const amplitude = Math.min((vertical ? width : height) / 2 - 14, 96);
    const turns = Math.max(1.5, Math.round((length / (amplitude * PITCH_TO_AMPLITUDE)) * 2) / 2);
    const samples = Math.ceil(length / SAMPLE_STEP_PX) + 1;

    geometry = {
      dpr,
      width,
      height,
      vertical,
      length,
      amplitude,
      samples,
      beadScale: clamp(amplitude / 72, 0.6, 1),
      wave: (TAU * turns) / length,
      rungs: pickRungCount(turns, Number(getComputedStyle(root).getPropertyValue('--key-grid')) || 5),
      pageCenter: root.getBoundingClientRect().top - shift + window.scrollY + root.offsetHeight / 2,
    };
    if (sin.length !== samples) {
      sin = new Float32Array(samples);
      cos = new Float32Array(samples);
    }
    root.style.setProperty('--amp', `${amplitude}px`);
    draw();
  }

  // Рисует отрезки обеих нитей, глубина которых попадает в заданный оттенок.
  function strokeShade(shade) {
    const { samples, amplitude } = geometry;
    ctx.beginPath();
    for (const side of [1, -1]) {
      let open = false;
      for (let i = 0; i < samples - 1; i += 1) {
        const depth = (side * (cos[i] + cos[i + 1])) / 2;
        if (shadeOf(depth) !== shade) {
          open = false;
          continue;
        }
        if (!open) ctx.moveTo(i * SAMPLE_STEP_PX, side * amplitude * sin[i]);
        ctx.lineTo((i + 1) * SAMPLE_STEP_PX, side * amplitude * sin[i + 1]);
        open = true;
      }
    }
    ctx.strokeStyle = shadeColors[shade];
    ctx.lineWidth = 1.6 + (1.2 * shade) / (SHADES - 1);
    ctx.stroke();
  }

  // Прорезает зазор под ближней нитью, чтобы в точке пересечения читалось «над — под».
  function carveCrossings() {
    const { samples, amplitude } = geometry;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    for (const side of [1, -1]) {
      let open = false;
      for (let i = 0; i < samples - 1; i += 1) {
        if ((side * (cos[i] + cos[i + 1])) / 2 < 0.3) {
          open = false;
          continue;
        }
        if (!open) ctx.moveTo(i * SAMPLE_STEP_PX, side * amplitude * sin[i]);
        ctx.lineTo((i + 1) * SAMPLE_STEP_PX, side * amplitude * sin[i + 1]);
        open = true;
      }
    }
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawRungs() {
    const { rungs, length, wave, amplitude } = geometry;
    ctx.strokeStyle = shadeColors[0];
    ctx.lineWidth = 1.4;
    for (let j = 0; j < rungs; j += 1) {
      const s = ((j + 0.5) / rungs) * length;
      const spread = Math.sin(wave * s + phase);
      const visibility = smoothstep(0.2, 0.62, Math.abs(spread));
      if (visibility < 0.01) continue;
      const reach = amplitude * spread * 0.94;
      ctx.globalAlpha = visibility;
      ctx.beginPath();
      ctx.moveTo(s, -reach);
      ctx.lineTo(s, reach);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Точки на нитях в местах крепления перекладин. «Дыхание» у каждой точки со своей фазой.
  function drawBeads(front) {
    const { rungs, length, wave, amplitude, beadScale } = geometry;
    const breath = reducedMotion.matches ? 0 : smallScreen.matches ? 0.035 : 0.06;
    for (let j = 0; j < rungs; j += 1) {
      const s = ((j + 0.5) / rungs) * length;
      const angle = wave * s + phase;
      for (const side of [1, -1]) {
        const depth = side * Math.cos(angle);
        if (depth >= 0 !== front) continue;
        const pulse = 1 + breath * Math.sin((TAU * clock) / BEAD_PERIOD_MS + j * 2.4 + side);
        ctx.fillStyle = shadeColors[shadeOf(depth)];
        ctx.beginPath();
        ctx.arc(s, side * amplitude * Math.sin(angle), (2.4 + 0.8 * (depth + 1)) * beadScale * pulse, 0, TAU);
        ctx.fill();
      }
    }
  }

  function draw() {
    const { dpr, width, height, vertical, samples, wave } = geometry;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Дальше рисуем в координатах «вдоль оси, поперёк оси»; для вертикальной спирали оси меняются местами.
    if (vertical) ctx.setTransform(0, dpr, dpr, 0, (width / 2) * dpr, 0);
    else ctx.setTransform(dpr, 0, 0, dpr, 0, (height / 2) * dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < samples; i += 1) {
      const angle = wave * i * SAMPLE_STEP_PX + phase;
      sin[i] = Math.sin(angle);
      cos[i] = Math.cos(angle);
    }

    const half = SHADES / 2;
    for (let shade = 0; shade < half; shade += 1) strokeShade(shade);
    drawBeads(false);
    drawRungs();
    carveCrossings();
    for (let shade = half; shade < SHADES; shade += 1) strokeShade(shade);
    drawBeads(true);
  }

  function tick(now) {
    const elapsed = Math.min(now - lastTime, 50);
    lastTime = now;
    clock += elapsed;

    // Скролл не управляет вращением, а лишь слегка ускоряет или замедляет его. Вклад сглажен и ограничен.
    const scrollY = window.scrollY;
    const velocity = elapsed > 0 ? (scrollY - lastScrollY) / elapsed : 0;
    lastScrollY = scrollY;
    scrollBoost += (clamp(velocity * 0.9, -0.8, 1.6) - scrollBoost) * (1 - Math.exp(-elapsed / 260));
    phase = (phase + elapsed * radiansPerMs * (1 + scrollBoost)) % TAU;

    const offset = (geometry.pageCenter - (scrollY + window.innerHeight / 2)) / window.innerHeight;
    shift = clamp(offset, -1, 1) * PARALLAX_PX;
    root.style.transform = `translate3d(0, ${shift.toFixed(2)}px, 0)`;

    draw();
    frame = requestAnimationFrame(tick);
  }

  function syncRunning() {
    const shouldRun = onScreen && !document.hidden && !reducedMotion.matches && geometry !== null;
    root.classList.toggle('is-paused', !shouldRun);
    if (shouldRun && !frame) {
      lastTime = performance.now();
      lastScrollY = window.scrollY;
      frame = requestAnimationFrame(tick);
    } else if (!shouldRun && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  function showStaticPose() {
    syncRunning();
    if (!reducedMotion.matches || !geometry) return;
    phase = STATIC_PHASE;
    shift = 0;
    root.style.transform = '';
    draw();
  }

  new ResizeObserver(measure).observe(root);
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    syncRunning();
  }).observe(root);
  document.addEventListener('visibilitychange', syncRunning);
  reducedMotion.addEventListener('change', showStaticPose);
  smallScreen.addEventListener('change', measure);

  measure();
  syncRunning();
}

for (const root of document.querySelectorAll('[data-helix]')) mountHelix(root);

// Блок «Наш подход» раскрывается один раз, когда доходит до вьюпорта.
if (!reducedMotion.matches) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove('is-waiting');
        revealObserver.unobserve(entry.target);
      }
    },
    { threshold: 0.25 },
  );
  for (const block of document.querySelectorAll('[data-reveal]')) {
    block.classList.add('is-waiting');
    revealObserver.observe(block);
  }
}
