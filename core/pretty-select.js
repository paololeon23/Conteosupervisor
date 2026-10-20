/** Select con menú propio (las option nativas casi no aceptan CSS). */

function labelOf(select) {
  const opt = select.selectedOptions?.[0] || select.options?.[select.selectedIndex];
  return String(opt?.textContent || opt?.label || 'Seleccione').trim();
}

function closeAll(except) {
  document.querySelectorAll('.pretty-select.is-open').forEach((wrap) => {
    if (except && wrap === except) return;
    wrap.classList.remove('is-open');
    const btn = wrap.querySelector('.pretty-select__btn');
    const menu = wrap.querySelector('.pretty-select__menu');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (menu) menu.hidden = true;
  });
}

function enhance(select) {
  if (!select || select.dataset.pretty === '1') return;
  const host = select.closest('.licapa-select') || select.parentElement;
  if (!host) return;
  select.dataset.pretty = '1';
  host.classList.add('licapa-select--pretty');

  const wrap = document.createElement('div');
  wrap.className = 'pretty-select';
  wrap.dataset.for = select.id || '';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pretty-select__btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'pretty-select__menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;

  const sync = () => {
    btn.textContent = labelOf(select);
    btn.classList.toggle('is-placeholder', !select.value);
    menu.querySelectorAll('.pretty-select__opt').forEach((optBtn) => {
      const on = optBtn.dataset.value === select.value;
      optBtn.classList.toggle('is-selected', on);
      optBtn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  };

  const rebuild = () => {
    menu.innerHTML = '';
    [...select.options].forEach((opt) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'pretty-select__opt';
      item.dataset.value = opt.value;
      item.setAttribute('role', 'option');
      item.textContent = String(opt.textContent || opt.label || '').trim();
      if (opt.disabled) item.disabled = true;
      item.addEventListener('click', () => {
        if (select.value !== opt.value) {
          select.value = opt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        sync();
        closeAll();
      });
      menu.appendChild(item);
    });
    sync();
  };

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const open = !wrap.classList.contains('is-open');
    closeAll();
    if (open) {
      wrap.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      menu.hidden = false;
    }
  });

  select.addEventListener('change', sync);

  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  if (desc?.set && desc?.get) {
    Object.defineProperty(select, 'value', {
      configurable: true,
      enumerable: true,
      get() { return desc.get.call(this); },
      set(v) {
        desc.set.call(this, v);
        sync();
      }
    });
  }

  select.classList.add('pretty-select__native');
  select.setAttribute('tabindex', '-1');
  select.setAttribute('aria-hidden', 'true');

  wrap.append(btn, menu);
  select.insertAdjacentElement('afterend', wrap);
  rebuild();
}

export function initPrettySelects(root = document) {
  root.querySelectorAll('.licapa-select select').forEach(enhance);
  if (document.documentElement.dataset.prettySelectDoc === '1') return;
  document.documentElement.dataset.prettySelectDoc = '1';
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('.pretty-select')) return;
    closeAll();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });
}
