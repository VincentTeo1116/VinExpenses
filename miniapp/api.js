/* Talks to the miniapp-api function. Every request carries Telegram's signed launch data; the page never sends a user id. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MiniApi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var CODES = ['unauthorized', 'expired', 'not_linked', 'limit', 'invalid', 'not_found', 'not_configured'];

    function ApiError(code, field, status) {
        this.name = 'ApiError';
        this.code = code;
        this.field = field || '';
        this.status = status || 0;
        this.message = code;
    }
    ApiError.prototype = Object.create(Error.prototype);

    /* options: baseUrl (your project address), getInitData, and optional anonKey, fetchImpl, timeoutMs. */
    function create(options) {
        var fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(typeof self !== 'undefined' ? self : undefined) : null);
        var timeoutMs = options.timeoutMs || 20000;
        var url = String(options.baseUrl || '').replace(/\/+$/, '') + '/functions/v1/miniapp-api';

        function call(body) {
            if (!fetchImpl) return Promise.reject(new ApiError('network'));
            var controller = typeof AbortController === 'function' ? new AbortController() : null;
            var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
            var headers = { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': options.getInitData() || '' };
            if (options.anonKey) headers.apikey = options.anonKey; // the public key: some gateways expect it, it grants nothing here
            return fetchImpl(url, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: controller ? controller.signal : undefined, credentials: 'omit', referrerPolicy: 'no-referrer' })
                .then(function (response) {
                    return response.json().catch(function () { return {}; }).then(function (data) { return { response: response, data: data }; });
                }, function () { throw new ApiError('network'); })
                .then(function (result) {
                    var response = result.response;
                    var data = result.data || {};
                    if (response.ok && data.ok !== false) return data;
                    var code = CODES.indexOf(data.error) !== -1 ? data.error : response.status === 401 ? 'unauthorized' : response.status === 403 ? 'not_linked' : response.status === 429 ? 'limit' : 'unavailable';
                    throw new ApiError(code, data.field, response.status);
                })
                .then(function (value) { if (timer) clearTimeout(timer); return value; }, function (error) { if (timer) clearTimeout(timer); throw error; });
        }

        return {
            call: call,
            bootstrap: function () { return call({ action: 'bootstrap' }); },
            month: function (offset) { return call({ action: 'month', offset: offset }); },
            transactions: function (params) { return call(Object.assign({ action: 'transactions' }, params)); },
            addExpense: function (values) { return call(Object.assign({ action: 'expense_add' }, values)); },
            updateExpense: function (id, values) { return call(Object.assign({ action: 'expense_update', id: id }, values)); },
            deleteExpense: function (id) { return call({ action: 'expense_delete', id: id }); },
        };
    }

    return { create: create, ApiError: ApiError, CODES: CODES };
});
