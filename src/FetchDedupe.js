import responseCache, { shouldUseCachedValue } from './response-cache.js';
import generateResponse from './generate-response.js';
import CacheMissError from './cache-miss-error.js'

export { responseCache, CacheMissError };

export class FetchDedupe {
  constructor(fetch) {
    this.fetch = fetch;
    this.activeRequestsStore = {};
    this.activeRequests = {};
    this.activeRequests.isRequestInFlight = this.isRequestInFlight;
    this.activeRequests.clear = this.clear;
  }

  clear() {
    this.activeRequestsStore = {};
  }

  fetchDedupe(input, options) {
    let url;
    let opts;
    if (typeof input === 'string') {
      url = input;
      opts = options || {};
    } else if (typeof input === 'object') {
      opts = input || {};
      url = opts.url;
    }

    const { requestKey, responseType = '', dedupe = true, cachePolicy, ...init } = opts;

    const method = init.method || '';
    const upperCaseMethod = method.toUpperCase();

    let appliedCachePolicy;
    if (cachePolicy) {
      appliedCachePolicy = cachePolicy;
    } else {
      const isReadRequest =
        upperCaseMethod === 'GET' ||
        upperCaseMethod === 'OPTIONS' ||
        upperCaseMethod === 'HEAD' ||
        upperCaseMethod === '';

      appliedCachePolicy = isReadRequest ? 'cache-first' : 'network-only';
    }
    // Build the default request key if one is not passed
    let requestKeyToUse =
      requestKey ||
      this.getRequestKey({
        // If `input` is a request, then we use that URL
        url,
        method: init.method || '',
        body: init.body || '',
      });

    if (appliedCachePolicy !== 'network-only') {
      if (shouldUseCachedValue(requestKeyToUse)) {
        return Promise.resolve(responseCache.get(requestKeyToUse));
      } else if (cachePolicy === 'cache-only') {
        const cacheError = new CacheMissError(
          `Response for fetch request not found in cache.`
        );
        return Promise.reject(cacheError);
      }
    }

    let proxyReq;
    if (dedupe) {
      if (!this.activeRequestsStore[requestKeyToUse]) {
        this.activeRequestsStore[requestKeyToUse] = [];
      }

      const handlers = this.activeRequestsStore[requestKeyToUse];
      const requestInFlight = Boolean(handlers.length);
      const requestHandler = {};
      proxyReq = new Promise((resolve, reject) => {
        requestHandler.resolve = resolve;
        requestHandler.reject = reject;
      });

      handlers.push(requestHandler);

      if (requestInFlight) {
        return proxyReq;
      }
    }

    const request = this.fetch(url, init).then(
      res => {
        let responseTypeToUse;
        if (responseType instanceof Function) {
          responseTypeToUse = responseType(res);
        } else if (responseType) {
          responseTypeToUse = responseType;
        } else if (res.status === 204) {
          responseTypeToUse = 'text';
        } else {
          responseTypeToUse = 'json';
        }
        // The response body is a ReadableStream. ReadableStreams can only be read a single
        // time, so we must handle that in a central location, here, before resolving
        // the fetch.
        return res[responseTypeToUse]().then(
          data => {
            res.data = data;
            responseCache.set(requestKeyToUse, res);

            if (dedupe) {
              this.resolveRequest({ requestKey: requestKeyToUse, res });
            } else {
              return generateResponse(res);
            }
          },
          () => {
            res.data = null;

            if (dedupe) {
              this.resolveRequest({ requestKey: requestKeyToUse, res });
            } else {
              return generateResponse(res);
            }
          }
        );
      },
      err => {
        if (dedupe) {
          this.resolveRequest({ requestKey: requestKeyToUse, err });
        } else {
          return Promise.reject(err);
        }
      }
    );

    if (dedupe) {
      return proxyReq;
    } else {
      return request;
    }
}

  getRequestKey({ url = '',  method = '', responseType = '',  body = '' } = {}) {
    return [url, method.toUpperCase(), responseType, body].join('||');
  }

  isRequestInFlight(requestKey) {
    const handlers = this.activeRequestsStore[requestKey];
    if (handlers && handlers.length) return Boolean(handlers.length);
    return false;
  }

  resolveRequest({ requestKey, res, err }) {
    const handlers = this.activeRequestsStore[requestKey] || [];

    handlers.forEach(handler => {
      if (res) {
        handler.resolve(this.generateResponse(res));
      } else {
        handler.reject(err);
      }
    });

    // This list of handlers has been, well, handled. So we
    // clear the handlers for the next request.
    this.activeRequestsStore[requestKey] = null;
  }

}
