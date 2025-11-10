const trackAbbreviationsToNames = {
	"MBC": "mario bros. circuit",
	"CC": "crown city",
	"WS": "whistlestop summit",
	"DKS": "dk spaceport",
	"rDH": "desert hills",
	"rSGB": "shy guy bazaar",
	"rWS": "wario stadium",
	"rAF": "airship fortress",
	"rDKP": "dk pass",
	"SP": "starview peak",
	"rSHS": "sky-high sundae",
	"rWSh": "wario shipyard",
	"rKTB": "koopa troopa beach",
	"FO": "faraway oasis",
	"PS": "peach stadium",
	"rPB": "peach beach",
	"SSS": "salty salty speedway",
	"rDDJ": "dino dino jungle",
	"GBR": "great ? block ruins",
	"CCF": "cheep cheep falls",
	"DD": "dandelion depths",
	"BCi": "boo cinema",
	"DBB": "dry bones burnout",
	"rMMM": "moo moo meadows",
	"rCM": "choco mountain",
	"rTF": "toad's factory",
	"BC": "bowser's castle",
	"AH": "acorn heights",
	"rMC": "mario circuit",
	"RR": "rainbow road",
};

const trackNamesToAbbreviations = Object.fromEntries(
	Object.entries(trackAbbreviationsToNames).map(([abbreviation, name]) => [name, abbreviation]),
);

const trackNames = Object.keys(trackAbbreviationsToNames);
const trackAbbreviations = Object.values(trackAbbreviationsToNames);

function getRandomTrack() {
	return trackNames[Math.floor(Math.random() * 30)];
}

module.exports = {
	trackNames,
	trackAbbreviations,
	trackAbbreviationsToNames,
	trackNamesToAbbreviations,
	getRandomTrack,
};

