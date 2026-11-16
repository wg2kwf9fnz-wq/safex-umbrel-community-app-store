'use strict';

// The upstream setup screen expects its desktop shell to relaunch after setup.
// In Umbrel, the server adapter performs that restart; reload the app root
// once the finish response has been received.
(() => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const requestUrl = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
    if (requestUrl.includes('/api/setup/finish') && response.ok) {
      const result = await response.clone().json().catch(() => null);
      if (result && result.ok) {
        window.setTimeout(() => window.location.replace('/'), 3000);
      }
    }
    return response;
  };
})();
