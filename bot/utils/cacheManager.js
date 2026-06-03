function scheduleExpiry(cacheMap, timerMap, key, ttlMs, onExpire) {
	if (!cacheMap || !timerMap || !key) {
		return;
	}
	const existing = timerMap.get(key);
	if (existing) {
		clearTimeout(existing);
		timerMap.delete(key);
	}
	if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
		return;
	}
	const timeout = setTimeout(() => {
		timerMap.delete(key);
		cacheMap.delete(key);
		if (typeof onExpire === "function") {
			try {
				onExpire(key);
			}
			catch (error) {
				console.warn("cacheManager: onExpire handler failed", error);
			}
		}
	}, ttlMs);
	if (typeof timeout.unref === "function") {
		timeout.unref();
	}
	timerMap.set(key, timeout);
}

function setCacheEntry(cacheMap, timerMap, key, value, ttlMs, onExpire) {
	if (!cacheMap || !key) {
		return value;
	}
	cacheMap.set(key, value);
	scheduleExpiry(cacheMap, timerMap, key, ttlMs, onExpire);
	return value;
}

function refreshCacheEntry(cacheMap, timerMap, key, ttlMs) {
	if (!cacheMap || !cacheMap.has(key)) {
		return;
	}
	scheduleExpiry(cacheMap, timerMap, key, ttlMs);
}

function deleteCacheEntry(cacheMap, timerMap, key) {
	if (!cacheMap || !key) {
		return;
	}
	if (timerMap) {
		const timer = timerMap.get(key);
		if (timer) {
			clearTimeout(timer);
			timerMap.delete(key);
		}
	}
	cacheMap.delete(key);
}

function clearCache(cacheMap, timerMap) {
	if (timerMap) {
		for (const timer of timerMap.values()) {
			clearTimeout(timer);
		}
		timerMap.clear();
	}
	if (cacheMap) {
		cacheMap.clear();
	}
}

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
	setCacheEntry,
	refreshCacheEntry,
	deleteCacheEntry,
	clearCache,
	createSessionStore,
	createRenderTracker,
};
