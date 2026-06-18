export function registerPwa() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return { supported: false };
  }

  const installButton = document.querySelector('#installTop');
  let installPrompt = null;

  if (installButton) {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      installPrompt = event;
      installButton.hidden = false;
    });

    installButton.addEventListener('click', async () => {
      if (!installPrompt) return;
      installButton.hidden = true;
      installPrompt.prompt();
      try {
        await installPrompt.userChoice;
      } finally {
        installPrompt = null;
      }
    });

    window.addEventListener('appinstalled', () => {
      installPrompt = null;
      installButton.hidden = true;
    });
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url) }).catch(() => {});
  });

  return { supported: true };
}
