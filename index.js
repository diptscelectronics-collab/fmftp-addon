const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const MOVIE_BASE_URL = "https://fmftp.net/data/disk-1/movies/";
const SERIES_BASE_URL = "https://fmftp.net/data/disk-1/tvseries/";

const manifest = {
    id: "org.fmftp.allmovies.nuvio",
    version: "1.4.0",
    name: "FMFTP Movies & Series",
    description: "Fast BDIX Movie & TV Series Streaming Addon",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["fmftp_", "tt"],
    catalogs: [
        {
            type: "movie",
            id: "fmftp_all_movies",
            name: "FMFTP Movies",
            extra: [
                { name: "skip", isRequired: false },
                { name: "search", isRequired: false }
            ]
        },
        {
            type: "series",
            id: "fmftp_all_series",
            name: "FMFTP TV Series",
            extra: [
                { name: "skip", isRequired: false },
                { name: "search", isRequired: false }
            ]
        }
    ]
};

const builder = new addonBuilder(manifest);

const movieCategories = ["hindidub/", "bollywood/", "hollywood/"];
const seriesCategories = ["english/", "bangla/", "hindi/", "korean/", ""];

const movieMap = new Map();
const seriesMap = new Map();
let lastMovieCacheTime = 0;
let lastSeriesCacheTime = 0;

function encodeId(url) {
    return "fmftp_" + Buffer.from(url).toString("base64url");
}

function decodeId(id) {
    try {
        const b64 = id.replace(/^fmftp_/, "");
        return Buffer.from(b64, "base64url").toString("utf-8");
    } catch (e) {
        return "";
    }
}

function cleanName(raw) {
    return raw.replace(/\//g, "").replace(/\(\d{4}\)/g, "").replace(/\[.*?\]/g, "").trim();
}

// ১০০% নির্ভরযোগ্য পোস্টার ইউআরএল জেনারেটর
function getPosterUrl(title, type) {
    const encodedTitle = encodeURIComponent(title);
    // UI Avatars CDN দিয়ে পোস্টার তৈরি (যা কখনোই ব্লক হবে না)
    return `https://ui-avatars.com/api/?name=${encodedTitle}&background=1e1e2e&color=cdd6f4&size=512&bold=true&font-size=0.33`;
}

function buildVideoObject(fileUrl, fileName, defaultSeason, defaultEp) {
    const cleanFileName = fileName.replace(/\.[^/.]+$/, "");
    const sAndE = cleanFileName.match(/s(\d+)e(\d+)/i) || cleanFileName.match(/(\d+)x(\d+)/i);
    let s = defaultSeason;
    let e = defaultEp;

    if (sAndE) {
        s = parseInt(sAndE[1]);
        e = parseInt(sAndE[2]);
    } else {
        const epOnly = cleanFileName.match(/e(?:pisode)?\s*(\d+)/i) || cleanFileName.match(/ep\s*(\d+)/i);
        if (epOnly) {
            e = parseInt(epOnly[1]);
        }
    }

    return {
        id: encodeId(fileUrl),
        title: cleanFileName,
        season: s,
        episode: e,
        released: new Date().toISOString()
    };
}

async function loadMovies() {
    if (movieMap.size > 0 && (Date.now() - lastMovieCacheTime < 3600000)) {
        return Array.from(movieMap.values());
    }
    try {
        console.log("Loading FMFTP Movies...");
        for (const cat of movieCategories) {
            const catUrl = MOVIE_BASE_URL + cat;
            try {
                const response = await axios.get(catUrl, { timeout: 15000 });
                const $ = cheerio.load(response.data);

                $("a").each((i, element) => {
                    const folderName = $(element).text().trim();
                    const folderHref = $(element).attr("href");

                    if (folderHref) {
                        const nameClean = folderName.replace(/\//g, "").trim();
                        if (nameClean && nameClean !== ".." && nameClean !== "." && !folderHref.startsWith("?") && !folderHref.startsWith("/")) {
                            const fullUrl = catUrl + folderHref;
                            const id = encodeId(fullUrl);
                            const cleanTitle = cleanName(nameClean);

                            movieMap.set(id, {
                                id: id,
                                fullUrl: fullUrl,
                                cleanTitle: cleanTitle,
                                type: "movie",
                                poster: getPosterUrl(cleanTitle, "movie")
                            });
                        }
                    }
                });
            } catch (err) {}
        }
        lastMovieCacheTime = Date.now();
        console.log(`Successfully loaded ${movieMap.size} movies.`);
    } catch (e) {}
    return Array.from(movieMap.values());
}

async function loadSeries() {
    if (seriesMap.size > 0 && (Date.now() - lastSeriesCacheTime < 3600000)) {
        return Array.from(seriesMap.values());
    }
    try {
        console.log("Loading FMFTP Series...");
        for (const cat of seriesCategories) {
            const catUrl = SERIES_BASE_URL + cat;
            try {
                const response = await axios.get(catUrl, { timeout: 15000 });
                const $ = cheerio.load(response.data);

                $("a").each((i, element) => {
                    const folderName = $(element).text().trim();
                    const folderHref = $(element).attr("href");

                    if (folderHref) {
                        const nameClean = folderName.replace(/\//g, "").trim();
                        if (nameClean && nameClean !== ".." && nameClean !== "." && !folderHref.startsWith("?") && !folderHref.startsWith("/")) {
                            const fullUrl = catUrl + folderHref;
                            const id = encodeId(fullUrl);
                            const cleanTitle = cleanName(nameClean);

                            seriesMap.set(id, {
                                id: id,
                                fullUrl: fullUrl,
                                cleanTitle: cleanTitle,
                                type: "series",
                                poster: getPosterUrl(cleanTitle, "series")
                            });
                        }
                    }
                });
            } catch (err) {}
        }
        lastSeriesCacheTime = Date.now();
        console.log(`Successfully loaded ${seriesMap.size} series.`);
    } catch (e) {}
    return Array.from(seriesMap.values());
}

// ১. ক্যাটালগ হ্যান্ডলার
builder.defineCatalogHandler(async (args) => {
    let list = args.type === "series" ? Array.from(seriesMap.values()) : Array.from(movieMap.values());

    if (list.length === 0) {
        list = args.type === "series" ? await loadSeries() : await loadMovies();
    }

    if (args.extra && args.extra.search) {
        const query = args.extra.search.toLowerCase().trim();
        list = list.filter(m => m.cleanTitle.toLowerCase().includes(query));
    }

    const skip = args.extra && args.extra.skip ? parseInt(args.extra.skip) : 0;
    const paginatedList = list.slice(skip, skip + 30);

    const metas = paginatedList.map((m) => ({
        id: m.id,
        type: m.type,
        name: m.cleanTitle,
        poster: m.poster,
        posterShape: "poster"
    }));

    return { metas: metas };
});

// ২. মেটা হ্যান্ডলার
builder.defineMetaHandler(async (args) => {
    const isSeries = args.type === "series";
    let item = isSeries ? seriesMap.get(args.id) : movieMap.get(args.id);
    let title = "Item";
    let folderUrl = "";

    if (item) {
        title = item.cleanTitle;
        folderUrl = item.fullUrl;
    } else {
        folderUrl = decodeId(args.id);
        const pathParts = folderUrl.split("/").filter(Boolean);
        const rawName = decodeURIComponent(pathParts[pathParts.length - 1] || "Item");
        title = cleanName(rawName);
    }

    const metaObj = {
        id: args.id,
        type: args.type,
        name: title,
        genres: ["BDIX Stream"],
        poster: getPosterUrl(title, args.type),
        posterShape: "poster",
        background: getPosterUrl(title, args.type),
        description: `Direct High-Speed BDIX Stream from FMFTP Server.\n\nTitle: ${title}`
    };

    if (isSeries && folderUrl) {
        const videos = [];
        try {
            const rootRes = await axios.get(folderUrl, { timeout: 5000 });
            const $ = cheerio.load(rootRes.data);
            const subFolders = [];
            let rootEpCount = 1;

            $("a").each((i, el) => {
                const href = $(el).attr("href");
                const name = $(el).text().trim();
                if (href && name !== ".." && name !== "." && !href.startsWith("?") && !href.startsWith("/")) {
                    const fullHref = folderUrl.endsWith("/") ? folderUrl + href : folderUrl + "/" + href;
                    if (href.match(/\.(mp4|mkv|avi|webm)$/i)) {
                        videos.push(buildVideoObject(fullHref, name, 1, rootEpCount++));
                    } else if (href.endsWith("/") || !href.includes(".")) {
                        subFolders.push({ url: fullHref, name: name });
                    }
                }
            });

            if (subFolders.length > 0) {
                await Promise.all(subFolders.map(async (sf, sfIndex) => {
                    try {
                        const seasonMatch = sf.name.match(/season\s*(\d+)/i) || sf.name.match(/s(\d+)/i);
                        const sNum = seasonMatch ? parseInt(seasonMatch[1]) : (sfIndex + 1);
                        const subRes = await axios.get(sf.url, { timeout: 5000 });
                        const $sub = cheerio.load(subRes.data);
                        let subEpCount = 1;

                        $sub("a").each((j, el2) => {
                            const href2 = $sub(el2).attr("href");
                            const name2 = $sub(el2).text().trim();
                            if (href2 && name2 !== ".." && name2 !== "." && !href2.startsWith("?") && !href2.startsWith("/")) {
                                const fullHref2 = sf.url.endsWith("/") ? sf.url + href2 : sf.url + "/" + href2;
                                if (href2.match(/\.(mp4|mkv|avi|webm)$/i)) {
                                    videos.push(buildVideoObject(fullHref2, name2, sNum, subEpCount++));
                                }
                            }
                        });
                    } catch (e) {}
                }));
            }

            if (videos.length > 0) {
                videos.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
                metaObj.videos = videos;
            }
        } catch (err) {}
    }

    return { meta: metaObj };
});

// ৩. স্মার্ট স্ট্রিম হ্যান্ডলার
builder.defineStreamHandler(async (args) => {
    try {
        let streamUrl = "";
        let searchTitle = "";

        if (args.id.startsWith("tt")) {
            const imdbId = args.id.split(":")[0];
            try {
                const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/${args.type}/${imdbId}.json`, { timeout: 3000 });
                if (metaRes.data && metaRes.data.meta && metaRes.data.meta.name) {
                    searchTitle = metaRes.data.meta.name.toLowerCase();
                }
            } catch (err) {}

            if (searchTitle) {
                const list = args.type === "series" ? Array.from(seriesMap.values()) : Array.from(movieMap.values());
                const matchedItem = list.find(m => {
                    const t1 = m.cleanTitle.toLowerCase();
                    return t1.includes(searchTitle) || searchTitle.includes(t1);
                });
                if (matchedItem) {
                    streamUrl = matchedItem.fullUrl;
                }
            }
        } else {
            streamUrl = decodeId(args.id);
        }

        if (!streamUrl) return { streams: [] };

        if (streamUrl.match(/\.(mp4|mkv|avi|webm)$/i)) {
            return {
                streams: [{ title: "▶ Play on FMFTP (BDIX Speed)", url: streamUrl }]
            };
        }

        const response = await axios.get(streamUrl, { timeout: 5000 });
        const $ = cheerio.load(response.data);
        let videoLink = "";

        $("a").each((i, element) => {
            const href = $(element).attr("href");
            if (href && href.match(/\.(mp4|mkv|avi|webm)$/i)) {
                videoLink = streamUrl.endsWith("/") ? streamUrl + href : streamUrl + "/" + href;
            }
        });

        if (videoLink) {
            return {
                streams: [{ title: "▶ Play Movie on FMFTP (BDIX Speed)", url: videoLink }]
            };
        }
    } catch (error) {}

    return { streams: [] };
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });

console.log(`Addon v1.4.0 running at http://localhost:${PORT}/manifest.json`);

loadMovies();
loadSeries();
