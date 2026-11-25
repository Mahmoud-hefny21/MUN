// Install support: keeps the browser's install prompt so the app can offer a one-tap "Install app" button.
const munInstall = (() => {
  let deferred = null;
  const listeners = new Set();
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferred = event;
    listeners.forEach(listener => listener());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach(listener => listener());
  });
  return {
    standalone, ios,
    canPrompt: () => Boolean(deferred),
    onChange: listener => listeners.add(listener),
    async prompt() {
      if (!deferred) return false;
      const event = deferred;
      deferred = null;
      await event.prompt();
      return (await event.userChoice).outcome === 'accepted';
    }
  };
})();

// Auto-update: a new service worker activates by itself and the page reloads when it is safe
// (not busy, nobody typing), otherwise the next time the app is hidden.
if ('serviceWorker' in navigator && window.isSecureContext) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let pendingReload = false;
  const typing = () => document.activeElement?.matches('input, textarea, select') && document.activeElement.value;
  const reloadWhenSafe = () => {
    if (document.visibilityState === 'hidden' || (document.body.getAttribute('aria-busy') !== 'true' && !typing())) location.reload();
    else pendingReload = true;
  };
  document.addEventListener('visibilitychange', () => {
    if (pendingReload && document.visibilityState === 'hidden') location.reload();
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) reloadWhenSafe();
  });
  navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(registration => {
    const activate = worker => worker?.postMessage('ACTIVATE_UPDATE');
    if (registration.waiting) activate(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) activate(worker);
      });
    });
    const check = () => registration.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch(() => {});
}
