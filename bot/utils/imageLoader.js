const { loadImage } = require("canvas");

function createImageLoader(contextLabel = "image") {
	return async function loadImageResource(resource, label = null) {
		if (!resource) {
			return null;
		}
		try {
			return await loadImage(resource);
		}
		catch (error) {
			const descriptor = label || resource;
			console.warn(`${contextLabel}: failed to load image ${descriptor}:`, error);
			return null;
		}
	};
}

module.exports = {
	createImageLoader,
};
