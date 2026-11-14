// The docs work without this. It adds the search, the copy buttons, this instance's own address in
// the examples, the calculator on the permissions page and the source offer in the footer, and the
// light of the look: the threads behind a page's opening, the ring that trails the pointer, and what
// is further down rising into view. It asks nothing of any other server.
(() => {
  const INSTANCE_HOST = 'your.instance';

  // ── The light: decoration, and none of it moves for someone who asked for less motion ──

  const STILL = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Bands of light threads: where each runs, how far it swings, its light, its pace. */
  const BANDS = {
    hero: [
      { y: 0.52, amplitude: 0.11, light: '242 242 242', speed: 0.22, phase: 0 },
      { y: 0.66, amplitude: 0.08, light: '158 158 158', speed: 0.16, phase: 2.1 },
      { y: 0.34, amplitude: 0.07, light: '242 242 242', speed: 0.12, phase: 4.2 },
    ],
    quiet: [{ y: 0.6, amplitude: 0.16, light: '242 242 242', speed: 0.14, phase: 1.3 }],
  };
  const THREADS = 22;
  const FRAME_MS = 1000 / 30;

  /**
   * The field of fine light threads behind the opening of a page (as the app's ui/LightField.tsx):
   * a canvas in each `data-light` host, thirty frames a second, resting while off screen or in a
   * hidden tab, and one still frame with reduced motion.
   */
  function startLight() {
    for (const host of document.querySelectorAll('[data-light]')) {
      const canvas = document.createElement('canvas');
      canvas.className = 'light-field';
      canvas.setAttribute('aria-hidden', 'true');
      host.prepend(canvas);
      const pen = canvas.getContext('2d');
      if (!pen) continue;
      const kind = host.dataset.light === 'hero' ? 'hero' : 'quiet';
      const bands = BANDS[kind];
      const strength = kind === 'hero' ? 0.16 : 0.1;
      let width = 0;
      let height = 0;
      let visible = true;
      let last = 0;

      const measure = () => {
        const ratio = Math.min(1.5, window.devicePixelRatio || 1);
        width = canvas.clientWidth;
        height = canvas.clientHeight;
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(height * ratio));
        pen.setTransform(ratio, 0, 0, ratio, 0, 0);
      };
      const draw = (time) => {
        const t = time / 1000;
        pen.clearRect(0, 0, width, height);
        pen.globalCompositeOperation = 'lighter';
        const step = Math.max(6, width / 180);
        for (const band of bands) {
          const base = band.y * height;
          const amplitude = band.amplitude * height;
          for (let thread = 0; thread < THREADS; thread += 1) {
            // Threads near the middle of a band are the brightest: a soft, fabric-like falloff.
            const offset = thread / (THREADS - 1) - 0.5;
            pen.strokeStyle = `rgb(${band.light} / ${(strength * Math.exp(-(offset * offset) * 10)).toFixed(3)})`;
            pen.lineWidth = 1;
            pen.beginPath();
            for (let x = -step; x <= width + step; x += step) {
              const u = x / Math.max(1, width);
              const y = base
                + offset * amplitude * 1.6
                + amplitude * Math.sin(u * 5.2 + t * band.speed * 2 + band.phase + offset * 1.4)
                + amplitude * 0.45 * Math.sin(u * 11.5 - t * band.speed * 3.1 + band.phase * 1.7 - offset * 2.2);
              if (x < 0) pen.moveTo(x, y);
              else pen.lineTo(x, y);
            }
            pen.stroke();
          }
        }
        pen.globalCompositeOperation = 'source-over';
      };

      measure();
      draw(4000);
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => {
          measure();
          draw(STILL ? 4000 : window.performance.now());
        }).observe(canvas);
      }
      if (STILL) continue;
      if (typeof IntersectionObserver !== 'undefined') {
        new IntersectionObserver((entries) => { visible = entries.some((entry) => entry.isIntersecting); }).observe(canvas);
      }
      const loop = (time) => {
        window.requestAnimationFrame(loop);
        if (!visible || document.hidden || time - last < FRAME_MS) return;
        last = time;
        draw(time);
      };
      window.requestAnimationFrame(loop);
    }
  }

  /**
   * For a mouse: a soft ring of light that trails the pointer and opens up over what can be pressed,
   * and frames marked `data-glare`, which are told where the pointer is so they can catch its light.
   * The cursor itself stays. It rests while the pointer does.
   */
  function startPointer() {
    if (STILL || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const ring = document.createElement('div');
    ring.className = 'pointer-aura';
    ring.setAttribute('aria-hidden', 'true');
    document.body.append(ring);
    let x = -200;
    let y = -200;
    let ax = x;
    let ay = y;
    let active = false;
    let frame = 0;

    const tick = () => {
      ax += (x - ax) * 0.2;
      ay += (y - ay) * 0.2;
      ring.style.transform = `translate(${ax}px, ${ay}px) translate(-50%, -50%) scale(${active ? 1.65 : 1})`;
      ring.dataset.active = active ? 'true' : 'false';
      frame = Math.abs(x - ax) + Math.abs(y - ay) > 0.1 ? window.requestAnimationFrame(tick) : 0;
    };
    window.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      x = event.clientX;
      y = event.clientY;
      const target = event.target instanceof window.Element ? event.target : null;
      active = Boolean(target?.closest('a, button, input, summary, label'));
      const lit = target?.closest('[data-glare]');
      if (lit) {
        const box = lit.getBoundingClientRect();
        lit.style.setProperty('--px', `${Math.round(x - box.left)}px`);
        lit.style.setProperty('--py', `${Math.round(y - box.top)}px`);
      }
      ring.style.opacity = '1';
      if (!frame) frame = window.requestAnimationFrame(tick);
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { ring.style.opacity = '0'; });
  }

  /** What is below the first screen rises into view when it is reached. What is already in view is left alone. */
  function startReveal() {
    if (STILL || typeof IntersectionObserver === 'undefined') return;
    const waiting = [...document.querySelectorAll('[data-reveal]')].filter((element) => element.getBoundingClientRect().top > window.innerHeight * 0.92);
    if (waiting.length === 0) return;
    const sight = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.dataset.reveal = 'in';
        sight.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    for (const element of waiting) {
      element.dataset.reveal = 'wait';
      sight.observe(element);
    }
  }

  /** The examples say the address of the instance being read, so they can be copied as they are. */
  function showOwnAddress() {
    const host = window.location.host;
    if (!host) return;
    for (const code of document.querySelectorAll('code')) {
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      const secure = window.location.protocol === 'https:';
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.nodeValue.includes(INSTANCE_HOST)) continue;
        node.nodeValue = node.nodeValue
          .replaceAll(`https://${INSTANCE_HOST}`, `${secure ? 'https' : 'http'}://${host}`)
          .replaceAll(`wss://${INSTANCE_HOST}`, `${secure ? 'wss' : 'ws'}://${host}`);
      }
    }
  }

  function addCopyButtons() {
    if (!navigator.clipboard) return;
    for (const block of document.querySelectorAll('pre')) {
      // Beside the code and not in it: what scrolls sideways must not take the button along.
      const frame = document.createElement('div');
      frame.className = 'code-block';
      block.replaceWith(frame);
      frame.append(block);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy-code';
      button.textContent = 'Copy';
      button.addEventListener('click', async () => {
        try {
          // Each line is its own element, with no line break in its text.
          const lines = [...block.querySelectorAll('.code-line')].map((line) => line.textContent);
          await navigator.clipboard.writeText(lines.join('\n'));
          button.textContent = 'Copied';
          setTimeout(() => { button.textContent = 'Copy'; }, 1500);
        } catch {
          button.textContent = 'Select it instead';
        }
      });
      frame.append(button);
    }
  }

  /** It stands beside the other legal links wherever they stand, and only the server knows where it leads. */
  async function showSourceOffer() {
    const link = document.getElementById('source-code');
    if (!link) return;
    try {
      const response = await fetch('/api/instance/info');
      const { sourceCodeUrl } = await response.json();
      if (typeof sourceCodeUrl !== 'string' || !/^(?:https?:\/\/|\/)/.test(sourceCodeUrl)) return;
      link.href = sourceCodeUrl;
      link.hidden = false;
    } catch {
      // The page reads as well without it, and the app and its legal pages say it too.
    }
  }

  /** On a phone the list of pages would stand before every page. Without this script it stays open. */
  function foldNavigation() {
    const navigation = document.querySelector('.docs-nav-toggle');
    if (navigation && window.matchMedia('(max-width: 760px)').matches) navigation.open = false;
  }

  function startCalculator() {
    const section = document.getElementById('calculator');
    if (!section) return;
    section.hidden = false;
    const value = document.getElementById('calculator-value');
    const boxes = [...section.querySelectorAll('input[type="checkbox"]')];
    const show = () => {
      const sum = boxes.filter((box) => box.checked).reduce((total, box) => total + BigInt(box.value), 0n);
      value.textContent = sum.toString();
    };
    for (const box of boxes) box.addEventListener('change', show);
  }

  function startSearch() {
    const input = document.getElementById('search');
    const list = document.getElementById('search-results');
    if (!input || !list) return;
    input.hidden = false;
    let index = null;
    let results = [];
    let selected = -1;

    const load = async () => {
      if (index) return;
      try {
        const response = await fetch('/developers/assets/search-index.json');
        index = await response.json();
      } catch {
        index = [];
      }
    };

    const close = () => {
      list.hidden = true;
      selected = -1;
    };

    const find = (query) => {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (words.length === 0 || !index) return [];
      const found = [];
      for (const page of index) {
        const haystack = `${page.title} ${page.description} ${page.text}`.toLowerCase();
        if (words.every((word) => haystack.includes(word))) {
          found.push({ href: `/developers/docs/${page.slug}`, title: page.title, note: page.description, score: page.title.toLowerCase().includes(words[0]) ? 2 : 0 });
        }
        for (const heading of page.headings) {
          const text = heading.text.toLowerCase();
          if (words.every((word) => text.includes(word))) {
            found.push({ href: `/developers/docs/${page.slug}#${heading.id}`, title: heading.text, note: page.title, score: 1 });
          }
        }
      }
      return found.sort((a, b) => b.score - a.score).slice(0, 12);
    };

    const paint = () => {
      list.replaceChildren();
      if (results.length === 0) {
        const none = document.createElement('li');
        none.className = 'search-empty';
        none.textContent = 'Nothing found.';
        list.append(none);
      }
      results.forEach((result, at) => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = result.href;
        link.textContent = result.title;
        if (at === selected) link.setAttribute('aria-current', 'true');
        const note = document.createElement('small');
        note.textContent = result.note;
        link.append(note);
        item.append(link);
        list.append(item);
      });
      list.hidden = false;
      // The list alone: anything that scrolls into view takes the page along.
      const current = list.querySelector('[aria-current]');
      if (current) {
        const item = current.getBoundingClientRect();
        const box = list.getBoundingClientRect();
        if (item.top < box.top) list.scrollTop -= box.top - item.top;
        else if (item.bottom > box.bottom) list.scrollTop += item.bottom - box.bottom;
      }
    };

    input.addEventListener('focus', () => { void load(); });
    input.addEventListener('input', async () => {
      await load();
      const query = input.value.trim();
      if (!query) {
        close();
        return;
      }
      results = find(query);
      selected = results.length > 0 ? 0 : -1;
      paint();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        close();
        input.blur();
      } else if (event.key === 'ArrowDown' && results.length > 0) {
        event.preventDefault();
        selected = (selected + 1) % results.length;
        paint();
      } else if (event.key === 'ArrowUp' && results.length > 0) {
        event.preventDefault();
        selected = (selected - 1 + results.length) % results.length;
        paint();
      } else if (event.key === 'Enter' && results[selected]) {
        window.location.assign(results[selected].href);
      }
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.site-search')) close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        event.preventDefault();
        input.focus();
      }
    });
  }

  showOwnAddress();
  addCopyButtons();
  foldNavigation();
  startCalculator();
  startSearch();
  void showSourceOffer();
  // Last, and each on its own: a browser that cannot draw one of them still has everything above.
  for (const decorate of [startLight, startPointer, startReveal]) {
    try {
      decorate();
    } catch {
      // The page reads the same without it.
    }
  }
})();
