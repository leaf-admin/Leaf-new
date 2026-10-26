(() => {
  'use strict';

  const motionPreference = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: true };
  const easing = 'cubic-bezier(.22, 1, .36, 1)';
  const animations = new Set();
  const revealed = new WeakSet();
  let revealObserver;

  // Content stays visible when animation APIs are unavailable or motion is reduced.
  function animate(element, keyframes, options = {}) {
    if (!element || motionPreference.matches || typeof element.animate !== 'function') return null;
    const animation = element.animate(keyframes, {
      duration: 300,
      easing,
      ...options
    });
    animations.add(animation);
    animation.finished.then(
      () => animations.delete(animation),
      () => animations.delete(animation)
    );
    return animation;
  }

  function setupTabs() {
    const tabList = document.querySelector('.audience-tabs');
    const panels = document.querySelector('.audience-panels');
    if (!tabList || !panels) return;

    const tabs = Array.from(tabList.querySelectorAll('[role="tab"]'));
    let heightAnimation;
    let contentAnimations = [];
    const initialTab = tabs.find(tab => tab.getAttribute('aria-selected') === 'true');
    if (!initialTab) return;
    tabList.dataset.audience = initialTab.id.replace('tab-', '');

    function selectAudience(audience, focus = false) {
      const nextTab = tabs.find(tab => tab.id === 'tab-' + audience);
      if (!nextTab) return;
      const nextPanel = document.getElementById(nextTab.getAttribute('aria-controls'));
      if (!nextPanel) return;
      if (nextTab.getAttribute('aria-selected') === 'true') {
        if (focus) nextTab.focus();
        return;
      }

      const previousHeight = panels.getBoundingClientRect().height;
      if (heightAnimation) heightAnimation.cancel();
      contentAnimations.forEach(animation => animation && animation.cancel());
      contentAnimations = [];

      tabs.forEach(tab => {
        const selected = tab === nextTab;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
      });
      tabList.dataset.audience = audience;
      if (focus) nextTab.focus();

      const nextHeight = nextPanel.getBoundingClientRect().height;
      if (Math.abs(previousHeight - nextHeight) > 1) {
        heightAnimation = animate(panels, [
          { height: previousHeight + 'px' },
          { height: nextHeight + 'px' }
        ], { duration: 340 });
      }
      contentAnimations = Array.from(nextPanel.children).map((element, index) => animate(element, [
        { opacity: 0, transform: 'translate3d(0, 7px, 0)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' }
      ], { duration: 280, delay: index * 35, fill: 'backwards' }));
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => selectAudience(tab.id.replace('tab-', '')));
      tab.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        if (next === undefined) return;
        event.preventDefault();
        selectAudience(tabs[next].id.replace('tab-', ''), true);
      });
    });

    document.querySelectorAll('[data-audience]').forEach(link => {
      link.addEventListener('click', () => selectAudience(link.dataset.audience));
    });
  }

  function setupReveals() {
    if (revealObserver) revealObserver.disconnect();
    if (motionPreference.matches || !('IntersectionObserver' in window)) return;

    revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const element = entry.target;
        revealObserver.unobserve(element);
        if (revealed.has(element)) return;
        revealed.add(element);
        const siblings = element.matches('.step') ? Array.from(element.parentElement.children) : [];
        const delay = Math.max(0, siblings.indexOf(element)) * 55;
        animate(element, [
          { opacity: 0, transform: 'translate3d(0, 14px, 0)' },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' }
        ], { duration: 620, delay, fill: 'backwards' });
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });

    document.querySelectorAll([
      '.section-heading', '.audience-card', '.care-band', '.how-heading',
      '.step', '.download-card', '.calc-page .intro', '.calc-card', '.next-step'
    ].join(',')).forEach(element => {
      if (!revealed.has(element)) revealObserver.observe(element);
    });
  }

  const header = document.querySelector('.site-header');
  if (header) {
    const updateHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 12);
    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });
  }

  setupTabs();
  setupReveals();

  // Feedback belongs to the card; financial values update immediately and once.
  const calculatorInput = document.getElementById('rideValue');
  const netCard = document.querySelector('.net-card');
  let resultAnimation;
  if (calculatorInput && netCard) {
    calculatorInput.addEventListener('input', () => {
      if (resultAnimation) resultAnimation.cancel();
      resultAnimation = animate(netCard, [
        { transform: 'translate3d(0, 2px, 0)' },
        { transform: 'translate3d(0, 0, 0)' }
      ], { duration: 240 });
    });
  }

  function updateMotionPreference() {
    if (motionPreference.matches) {
      animations.forEach(animation => animation.cancel());
      animations.clear();
      if (revealObserver) revealObserver.disconnect();
    } else {
      setupReveals();
    }
  }

  if (motionPreference.addEventListener) {
    motionPreference.addEventListener('change', updateMotionPreference);
  } else if (motionPreference.addListener) {
    motionPreference.addListener(updateMotionPreference);
  }
})();
