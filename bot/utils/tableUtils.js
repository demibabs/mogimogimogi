const DEFAULT_TABLE_DATE_FIELDS = ["verifiedOn", "createdOn", "date", "updatedOn"];

function getTableTimestamp(table, fields = DEFAULT_TABLE_DATE_FIELDS) {
	if (!table) {
		return null;
	}
	const fieldList = Array.isArray(fields) && fields.length ? fields : DEFAULT_TABLE_DATE_FIELDS;
	let raw = null;
	for (const field of fieldList) {
		if (!field) {
			continue;
		}
		const value = table[field];
		if (value) {
			raw = value;
			break;
		}
	}
	if (!raw) {
		return null;
	}
	const parsed = new Date(raw);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

module.exports = {
	getTableTimestamp,
	DEFAULT_TABLE_DATE_FIELDS,
};
