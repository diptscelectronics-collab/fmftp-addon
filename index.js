const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const MOVIE_BASE_URL = "https://fmftp.net/data/disk-1/movies/";
const SERIES_BASE_URL = "https://fmftp.net/data/disk-1/tvseries/";

const manifest = {
    id: "org.fmftp.allmovies.nuvio",
    version: "1.3.0",
    name: "FMFTP Movies & Series",
    description: "Fast BDIX Movie & TV Series Streaming Addon",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["fmftp_", "tt"], // Cinemeta / IMDB ID (tt...) সাপোর্ট দেওয়া হলো
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
                                poster: `https://v3-cinemeta.strem.io/poster/movie/${encodeURIComponent(cleanTitle)}.jpg`
                            });
                        }
                    }
                });
            } catch (err) {}
        }
        lastMovieCacheTime = Date.now();
    } catch (e) {}
    return Array.from(movieMap.values());
}

async function loadSeries() {
    if (seriesMap.size > 0 && (Date.now() - lastSeriesCacheTime < 3600000)) {
        return Array.from(seriesMap.values());
    }
    try {
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
                                poster: `https://v3-cinemeta.strem.io/poster/series/${encodeURIComponent(cleanTitle)}.jpg`
                            });
                        }
                    }
                });
            } catch (err) {}
        }
        lastSeriesCacheTime = Date.now();
    } catch (e) {}
    return Array.from(seriesMap.values());
}

// ১. ক্যাটালগ হ্যান্ডলার
builder.defineCatalogHandler(async (args) => {
    let list = args.type === "series" ? await loadSeries() : await loadMovies();

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
        poster: `https://v3-cinemeta.strem.io/poster/${args.type}/${encodeURIComponent(title)}.jpg`,
        posterShape: "poster"
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

// ৩. স্মার্ট স্ট্রিম হ্যান্ডলার (IMDB ID এবং Custom ID উভয়ই হ্যান্ডেল করবে)
builder.defineStreamHandler(async (args) => {
    try {
        let streamUrl = "";
        let searchTitle = "";

        // ১. যদি IMDB ID (tt123456) পাঠায় (Search রেজাল্টের পেজ থেকে ঢুকলে)
        if (args.id.startsWith("tt")) {
            const imdbId = args.id.split(":")[0]; // tt1234567:1:1 থেকে মূল IMDB ID বের করা
            
            // Cinemeta থেকে IMDB আইডি দিয়ে সিনেমার আসল নাম বের করা
            const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/${args.type}/${imdbId}.json`, { timeout: 3000 });
            if (metaRes.data && metaRes.data.meta && metaRes.data.meta.name) {
                searchTitle = metaRes.data.meta.name.toLowerCase();
            }

            if (searchTitle) {
                const list = args.type === "series" ? await loadSeries() : await loadMovies();
                // FMFTP মেমোরি থেকে শিরোনামের সাথে মেলাক
                const matchedItem = list.find(m => m.cleanTitle.toLowerCase().includes(searchTitle) || searchTitle.includes(m.cleanTitle.toLowerCase()));
                if (matchedItem) {
                    streamUrl = matchedItem.fullUrl;
                }
            }
        } else {
            // ২. যদি FMFTP-এর নিজস্ব আইডি পাঠায়
            streamUrl = decodeId(args.id);
        }

        if (!streamUrl) return { streams: [] };

        // সরাসরি ভিডিও ফাইল হলে
        if (streamUrl.match(/\.(mp4|mkv|avi|webm)$/i)) {
            return {
                streams: [{ title: "▶ Play on FMFTP (BDIX Speed)", url: streamUrl }]
            };
        }

        // ফোল্ডার হলে ভিডিও ফাইলটি স্ক্র্যাপ করা
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
                streams: [{ title: "▶ Play on FMFTP (BDIX Speed)", url: videoLink }]
            };
        }
    } catch (error) {}

    return { streams: [] };
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });

console.log(`Addon v1.3.0 running at http://localhost:${PORT}/manifest.json`);

loadMovies();
loadSeries();
