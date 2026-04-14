export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/pages')) {
      const slug = url.pathname.replace(/^\/pages\/?/, '');
      const targetUrl =
        'https://sospages.replit.app/sites/pagessubtrackers.spotonresults.com/' + slug + url.search;

      return fetch(targetUrl, {
        method: request.method,
        headers: request.headers,
      });
    }

    return fetch(request);
  }
};
