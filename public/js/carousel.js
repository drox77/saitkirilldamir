// Карусель проектов на нативном scroll-snap. Скрипт добавляет кнопки, перетаскивание мышью и полосу прогресса.

const DRAG_THRESHOLD_PX = 6;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const scrollBehavior = () => (reducedMotion.matches ? 'auto' : 'smooth');

function mountCarousel(root) {
  const track = root.querySelector('.carousel__track');
  const prev = root.querySelector('.carousel__btn--prev');
  const next = root.querySelector('.carousel__btn--next');
  const thumb = root.querySelector('.carousel__thumb');

  const maxScroll = () => track.scrollWidth - track.clientWidth;

  function cardStep() {
    const [first, second] = track.children;
    return second ? second.offsetLeft - first.offsetLeft : first.offsetWidth;
  }

  function update() {
    const max = maxScroll();
    const visible = max > 0 ? track.clientWidth / track.scrollWidth : 1;
    const progress = max > 0 ? Math.min(1, Math.max(0, track.scrollLeft / max)) : 0;
    thumb.style.setProperty('--visible', visible.toFixed(4));
    thumb.style.setProperty('--shift', `${((progress * (1 - visible)) / visible) * 100}%`);
    prev.disabled = track.scrollLeft <= 1;
    next.disabled = track.scrollLeft >= max - 1;
  }

  let updateQueued = false;
  function queueUpdate() {
    if (updateQueued) return;
    updateQueued = true;
    requestAnimationFrame(() => {
      updateQueued = false;
      update();
    });
  }

  prev.addEventListener('click', () => track.scrollBy({ left: -cardStep(), behavior: scrollBehavior() }));
  next.addEventListener('click', () => track.scrollBy({ left: cardStep(), behavior: scrollBehavior() }));
  track.addEventListener('scroll', queueUpdate, { passive: true });
  new ResizeObserver(update).observe(track);

  // Перетаскивание мышью. На тач-экранах прокрутку и привязку делает сам браузер.
  let drag = null;
  let suppressClick = false;

  track.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag = { startX: event.clientX, startScroll: track.scrollLeft, moved: false };
  });

  window.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const delta = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(delta) < DRAG_THRESHOLD_PX) return;
    if (!drag.moved) {
      drag.moved = true;
      track.classList.add('is-dragging');
      getSelection().removeAllRanges();
    }
    track.scrollLeft = drag.startScroll - delta;
  });

  function endDrag() {
    if (!drag) return;
    const { moved, startScroll } = drag;
    drag = null;
    if (!moved) return;

    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);

    // Доводим до ближайшей карточки плавно и только потом возвращаем scroll-snap, иначе будет рывок.
    const step = cardStep();
    const travelled = track.scrollLeft - startScroll;
    const round = Math.abs(travelled) > step * 0.15 ? (travelled > 0 ? Math.ceil : Math.floor) : Math.round;
    const target = Math.min(maxScroll(), Math.max(0, round(track.scrollLeft / step) * step));

    const restoreSnap = () => track.classList.remove('is-dragging');
    if (Math.abs(target - track.scrollLeft) < 1) {
      restoreSnap();
      return;
    }
    track.addEventListener('scrollend', restoreSnap, { once: true });
    setTimeout(restoreSnap, 700);
    track.scrollTo({ left: target, behavior: scrollBehavior() });
  }

  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  // После перетаскивания браузер шлёт click по ссылке под курсором — его нужно погасить.
  track.addEventListener(
    'click',
    (event) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );

  update();
}

for (const root of document.querySelectorAll('[data-carousel]')) mountCarousel(root);
