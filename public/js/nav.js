const header = document.querySelector('.site-header');
const toggle = header.querySelector('.nav-toggle');
const nav = header.querySelector('.site-nav');
const links = [...nav.querySelectorAll('.site-nav__list a')];

function setMenuOpen(open) {
  header.classList.toggle('is-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
}

toggle.addEventListener('click', () => setMenuOpen(!header.classList.contains('is-open')));

nav.addEventListener('click', (event) => {
  if (event.target.closest('a')) setMenuOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && header.classList.contains('is-open')) {
    setMenuOpen(false);
    toggle.focus();
  }
});

matchMedia('(min-width: 1024px)').addEventListener('change', () => setMenuOpen(false));

new IntersectionObserver(([entry]) => {
  header.classList.toggle('is-scrolled', !entry.isIntersecting);
}).observe(document.querySelector('.scroll-sentinel'));

// Подсвечивает в меню секцию, которая сейчас пересекает середину экрана.
const sectionObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const link = links.find((item) => item.hash === `#${entry.target.id}`);
      if (!link) continue;
      if (entry.isIntersecting) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  },
  { rootMargin: '-50% 0px -50% 0px' },
);

for (const section of document.querySelectorAll('main > section[id]')) sectionObserver.observe(section);
