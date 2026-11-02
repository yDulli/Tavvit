// The docs work without this. It adds the search, the copy buttons, this instance's own address in
// the examples, the calculator on the permissions page and the source offer in the footer. It asks
// nothing of any other server.
(() => {
  const INSTANCE_HOST = 'your.instance';

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
})();
