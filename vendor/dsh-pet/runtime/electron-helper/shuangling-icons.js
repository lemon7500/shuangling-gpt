/* Original geometric icons for the Shuangling controls. No font glyphs or external SVG input. */
(function (root) {
  'use strict';
  const paths = Object.freeze({
    overview: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    actions: 'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9 5l3 3 3-3M9 19l3-3 3 3M4.5 11l4.1-1.1-1.1-4.1M19.5 13l-4.1 1.1 1.1 4.1M7.5 18.2l1.1-4.1-4.1-1.1M16.5 5.8l-1.1 4.1 4.1 1.1',
    settings: 'M10 3h4l.7 3 2 .9 2.7-.9 2 3.5-2.1 2.1v2.3l2.1 2.1-2 3.5-2.7-.9-2 .9-.7 3h-4l-.7-3-2-.9-2.7.9-2-3.5 2.1-2.1v-2.3L2.6 9.5l2-3.5 2.7.9 2-.9.7-3ZM15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z',
    idle: 'M17.8 4.2A8.6 8.6 0 1 0 19.8 17 7.2 7.2 0 0 1 17.8 4.2Z',
    running: 'M5.5 17.5 3.5 20v-5A7.7 7.7 0 0 1 3 12a8.5 8.5 0 0 1 17 0 8.3 8.3 0 0 1-.9 3.8M8 10h7M8 13h4M16 18l1.5 1.5L21 16',
    review: 'M8 5H5v16h14V5h-3M8 3h8v4H8zM8 14l2.5 2.5L16 11',
    waiting: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7l-5 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM7 9h10M7 13h6',
    waving: 'M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v6M17 12V9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-12 0l-3-3a1.5 1.5 0 0 1 2.1-2.1L10 13M4 4 2.5 2.5M3 7H1.5',
    jumping: 'M12 4v10M8 8l4-4 4 4M6 17l-2 3h5l1-3M18 17l2 3h-5l-1-3',
    'running-left': 'M8 5a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM11 8l4 3 4-1M12 9l-3 5 4 3 2 4M9 14l-3 6H2M9.5 9.5l-3 2H3',
    'running-right': 'M16 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM13 8l-4 3-4-1M12 9l3 5-4 3-2 4M15 14l3 6h4M14.5 9.5l3 2H21',
    failed: 'M5 8c2-1 4-.6 7 1.5C15 7.4 17 7 19 8l-1 9c-2-1-4-.6-6 1-2-1.6-4-2-6-1L5 8ZM12 9.5V18M9 3l3 3 3-3',
    reading: 'M12 6c-2.5-2-5.5-2-9-1v14c3.5-1 6.5-1 9 1 2.5-2 5.5-2 9-1V5c-3.5-1-6.5-1-9 1ZM12 6v14M6 9h3M6 12h3M15 9h3M15 12h3',
    'looking-around': 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM19 3l1 1M21 6h1',
    'stretching-wings': 'M12 17c-2-5-5-8-10-10l3 10 4-2 3 5 3-5 4 2 3-10c-5 2-8 5-10 10ZM12 17v3',
    focus: 'M19.5 13.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0ZM9.5 3h5M12 3v3M17.5 7.5 19 6M12 9.5v4l2.75 1.75',
    journal: 'M12 6c-2.5-2-5.5-2-9-1v14c3.5-1 6.5-1 9 1 2.5-2 5.5-2 9-1V5c-3.5-1-6.5-1-9 1ZM12 6v14M6 9h3M6 12h3M15 9h3M15 12h3',
    notes: 'M7 3h10v18l-5-3-5 3V3ZM10 7h4',
    close: 'M6 6l12 12M18 6 6 18',
    home: 'M3 10l9-7 9 7M6 8v13h12V8M10 21v-7h4v7',
    hide: 'M3 3l18 18M9.5 6.4A11 11 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.5M6.2 7.2A20 20 0 0 0 2 12s3.5 6 10 6a11 11 0 0 0 4.7-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2',
    quit: 'M10 4H4v16h6M9 12h12M17 8l4 4-4 4',
    advanced: 'M14 4h6v6M20 4 10 14M10 5H4v15h15v-6',
    down: 'M7 10l5 5 5-5',
    play: 'M8 4l12 8-12 8V4Z',
    pause: 'M8 5v14M16 5v14',
    stop: 'M6 6h12v12H6z',
    rest: 'M4 8h13v6a6.5 6.5 0 0 1-13 0V8ZM17 9h2a3 3 0 0 1 0 6h-2M3 21h16M7 3v2M13 3v2',
    save: 'M4 3h13l3 3v15H4V3ZM8 3v6h8V3M8 21v-8h8v8',
    edit: 'M15 4l5 5M4 20l5-1 12-12-5-5L4 14v6ZM4 20l5-1',
    pin: 'M9 3h6M10 3v5l-4 4v2h12v-2l-4-4V3M12 14v7',
    archive: 'M3 4h18v4H3zM5 8v13h14V8M10 12h4',
    reply: 'M9 7 4 12l5 5M4 12h9a7 7 0 0 1 7 7V16a9 9 0 0 0-9-9',
    continue: 'M5 3h10v7M5 3v18l5-3 3 1.8M12 14h9M18 11l3 3-3 3',
    favorite: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z',
    trash: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
    history: 'M3 5v6h6M3 11a9 9 0 1 1 2 7M12 7v5l3 2',
    back: 'M10 5 3 12l7 7M3 12h18'
  });
  const namespace = 'http://www.w3.org/2000/svg';
  function create(name, document = root.document) {
    if (!Object.hasOwn(paths, name) || !document?.createElementNS) return null;
    const svg = document.createElementNS(namespace, 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false', class: 'shuangling-icon', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(key, value);
    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', paths[name]); svg.append(path);
    return svg;
  }
  function decorate(element, name = element?.dataset.icon) {
    if (!element || !Object.hasOwn(paths, name)) return element;
    element.dataset.icon = name;
    element.classList.add('icon-label-button');
    const current = element.querySelector('.shuangling-icon');
    if (current?.getAttribute('data-icon-name') === name) return element;
    const svg = create(name, element.ownerDocument || root.document);
    if (!svg) return element;
    svg.setAttribute('data-icon-name', name);
    if (current) current.replaceWith(svg); else element.prepend(svg);
    return element;
  }
  function setLabel(element, text, name) {
    if (!element) return element;
    if (name) element.dataset.icon = name;
    let label = element.querySelector('[data-icon-label]');
    if (!label) {
      element.replaceChildren();
      label = (element.ownerDocument || root.document).createElement('span');
      label.setAttribute('data-icon-label', ''); element.append(label);
    }
    label.textContent = text;
    return decorate(element);
  }
  function mount(document = root.document) {
    for (const element of document?.querySelectorAll('[data-icon]') || []) decorate(element);
  }
  const api = Object.freeze({ names: Object.freeze(Object.keys(paths)), create, decorate, setLabel, mount });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.shuanglingIcons = api; mount(); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
