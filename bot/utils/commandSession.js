const {
	setCacheEntry,
	refreshCacheEntry,
	deleteCacheEntry,
} = require("./cacheManager");

function createSessionStore({ ttlMs } = {}) {
	const cache = new Map();
	const expiryTimers = new Map();

	function get(messageId) {
		if (!messageId) {
			return null;
		}
		const session = cache.get(messageId);
		if (!session) {
			return null;
		}
		if (session.expiresAt && session.expiresAt <= Date.now()) {
			deleteCacheEntry(cache, expiryTimers, messageId);
			return null;
		}
		refreshCacheEntry(cache, expiryTimers, messageId, ttlMs);
		session.expiresAt = Date.now() + ttlMs;
		return session;
	}

	function store(messageId, session) {
		if (!messageId || !session) {
			return;
		}
		const expiresAt = Date.now() + ttlMs;
		const payload = {
			...session,
			messageId,
			expiresAt,
		};
		setCacheEntry(cache, expiryTimers, messageId, payload, ttlMs);
	}

	function refresh(messageId) {
		if (!messageId) {
			return;
		}
		const session = cache.get(messageId);
		if (!session) {
			return;
		}
		refreshCacheEntry(cache, expiryTimers, messageId, ttlMs);
		session.expiresAt = Date.now() + ttlMs;
	}

	return {
		cache,
		expiryTimers,
		get,
		store,
		refresh,
	};
}

function createRenderTracker() {
	const renderTokens = new Map();

	function begin(messageId, label = "render") {
		if (!messageId) {
			return null;
		}
		const token = Symbol(label);
		renderTokens.set(messageId, token);
		return token;
	}

	function isActive(messageId, token) {
		if (!messageId || !token) {
			return true;
		}
		return renderTokens.get(messageId) === token;
	}

	function end(messageId, token) {
		if (!messageId || !token) {
			return;
		}
		if (renderTokens.get(messageId) === token) {
			renderTokens.delete(messageId);
		}
	}

	return {
		renderTokens,
		begin,
		isActive,
		end,
	};
}

module.exports = {
	createSessionStore,
	createRenderTracker,
};
