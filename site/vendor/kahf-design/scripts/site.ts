/* Behaviour shared by every page: colour scheme, the phone menu, copy buttons. */

const KEY = 'color-scheme';
const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function rendered(): 'light' | 'dark' {
  const v = meta?.content;
  if (v === 'light' || v === 'dark') return v;
  return systemDark.matches ? 'dark' : 'light';
}

/* Two-state toggle: flip what the visitor sees. Matching the system clears the override,
   so the site goes back to following the system. A stored choice is never cleared retroactively. */
document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!meta) return;
    const target = rendered() === 'dark' ? 'light' : 'dark';
    const system = systemDark.matches ? 'dark' : 'light';
    try {
      if (target === system) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, target);
    } catch { /* storage blocked: still apply for this page */ }
    meta.content = target === system ? 'light dark' : target;
  });
});

window.addEventListener('storage', (e) => {
  if (e.key === KEY && meta) meta.content = e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : 'light dark';
});

/* Phone menu: a disclosure. */
const menuButton = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
const menu = menuButton ? document.getElementById(menuButton.getAttribute('aria-controls') ?? '') : null;

function setMenu(open: boolean, returnFocus = false) {
  if (!menuButton || !menu) return;
  menuButton.setAttribute('aria-expanded', String(open));
  menu.hidden = !open;
  if (!open && returnFocus) menuButton.focus();
}

menuButton?.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menuButton?.getAttribute('aria-expanded') === 'true') setMenu(false, true);
});
menu?.addEventListener('click', (e) => {
  if ((e.target as Element).closest('a')) setMenu(false);
});
window.matchMedia('(min-width: 760px)').addEventListener('change', (e) => { if (e.matches) setMenu(false); });

/* Copy buttons: [data-copy] holds the text. */
const announcer = document.querySelector<HTMLElement>('[data-announce]');
const copiedWord = document.documentElement.lang === 'ar' ? 'نُسخ' : 'Copied';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

document.querySelectorAll<HTMLElement>('[data-copy]').forEach((button) => {
  let timer: number | undefined;
  button.addEventListener('click', async () => {
    if (!(await copyText(button.dataset.copy ?? ''))) return;
    button.classList.add('is-copied');
    if (announcer) announcer.textContent = copiedWord;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      button.classList.remove('is-copied');
      if (announcer) announcer.textContent = '';
    }, 2000);
  });
});
