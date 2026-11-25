const munPush = (() => {
  let ready;
  let user;
  let activeSdk;
  const optedInHere = 'mun-push-browser';
  const identity = async () => {
    const response = await fetch('/api/push/identity', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    if (!response.ok) throw new Error('Push notifications are unavailable for this account.');
    return response.json();
  };
  function prepare() {
    if (ready) return ready;
    ready = identity().then(config => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
      const timeout = setTimeout(() => reject(new Error('Push setup timed out. Reload to retry.')), 10000);
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push(async sdk => {
        try {
          await sdk.init({
            appId: config.appId, safari_web_id: config.safariId || undefined,
            serviceWorkerPath: 'push/onesignal/OneSignalSDKWorker.js',
            serviceWorkerParam: { scope: '/push/onesignal/' },
            notifyButton: { enable: false },
            promptOptions: { slidedown: { prompts: [] } },
            welcomeNotification: { disable: true }
          });
          await sdk.login(config.externalId, config.jwt);
          sdk.User.addEventListener('userJwtInvalidated', async () => {
            try {
              const fresh = await identity();
              if (fresh.externalId === user) await sdk.updateUserJwt(fresh.jwt);
            } catch {}
          });
          user = config.externalId;
          activeSdk = sdk;
          resolve(sdk);
        } catch { reject(new Error('Push setup failed on this browser.')); }
        finally { clearTimeout(timeout); }
      });
      script.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('The push SDK could not load.'));
      };
      document.head.append(script);
    }));
    return ready;
  }
  function optIn() {
    if (!activeSdk?.Notifications.isPushSupported()) {
      throw new Error('Push requires a supported browser. On compatible iOS devices, install the app on the Home Screen first.');
    }
    return activeSdk.User.PushSubscription.optIn().then(() => {
      if (!activeSdk.Notifications.permission) throw new Error('Allow notifications in this browser to continue.');
      localStorage.setItem(optedInHere, 'true');
    });
  }
  async function optOut() {
    localStorage.removeItem(optedInHere);
    if (activeSdk) await activeSdk.User.PushSubscription.optOut();
  }
  async function logout() {
    if (localStorage.getItem(optedInHere) && !activeSdk) await prepare();
    localStorage.removeItem(optedInHere);
    if (activeSdk) await activeSdk.logout();
  }
  return { prepare, optIn, optOut, logout, isReady: () => Boolean(activeSdk) };
})();
