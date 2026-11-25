if ('serviceWorker' in navigator && window.isSecureContext) {
  const update = document.querySelector('#app-update');
  let reloading = false;
  navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(registration => {
    if (registration.waiting && navigator.serviceWorker.controller) update.hidden = false;
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) update.hidden = false;
      });
    });
    update.querySelector('button').addEventListener('click', () => {
      if (document.body.getAttribute('aria-busy') === 'true') return;
      if (!registration.waiting) return;
      reloading = true;
      registration.waiting.postMessage('ACTIVATE_UPDATE');
    });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });
}
