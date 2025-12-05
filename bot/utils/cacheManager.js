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

module.exports = {
	setCacheEntry,
	refreshCacheEntry,
	deleteCacheEntry,
	clearCache,
};
