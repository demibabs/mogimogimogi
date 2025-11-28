const DEFAULT_SAMPLE_INTERVAL_MS = Number(process.env.MEMORY_MONITOR_SAMPLE_MS) || 60_000;
const DEFAULT_LOG_WINDOW = Number(process.env.MEMORY_MONITOR_LOG_WINDOW) || 5;

function bytesToMB(bytes) {
	return (bytes / (1024 * 1024)).toFixed(2);
}

function formatUsage(memoryUsage) {
	return `rss: ${bytesToMB(memoryUsage.rss)} MB | heapUsed: ${bytesToMB(memoryUsage.heapUsed)} MB | external: ${bytesToMB(memoryUsage.external)} MB`;
}

function startMemoryMonitor(options = {}) {
	const sampleIntervalMs = options.sampleIntervalMs || DEFAULT_SAMPLE_INTERVAL_MS;
	const logWindow = options.logWindow || DEFAULT_LOG_WINDOW;
	if (sampleIntervalMs <= 0) {
		console.warn("memoryMonitor: invalid sample interval; skipping monitor start.");
		return null;
	}

	let samples = [];
	const timer = setInterval(() => {
		const usage = process.memoryUsage();
		samples.push(usage);
		if (samples.length >= logWindow) {
			const averages = samples.reduce((acc, current) => {
				acc.rss += current.rss;
				acc.heapUsed += current.heapUsed;
				acc.external += current.external;
				return acc;
			}, { rss: 0, heapUsed: 0, external: 0 });
			averages.rss /= samples.length;
			averages.heapUsed /= samples.length;
			averages.external /= samples.length;
			console.log(`[memory] samples=${samples.length} | ${formatUsage(averages)} | heapTotal: ${bytesToMB(usage.heapTotal)} MB`);
			samples = [];
		}
	}, sampleIntervalMs);

	timer.unref?.();

	return {
		stop() {
			clearInterval(timer);
		},
	};
}

module.exports = {
	startMemoryMonitor,
};
