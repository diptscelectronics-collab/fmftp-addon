const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const MOVIE_BASE_URL = "https://fmftp.net/data/disk-1/movies/";
const SERIES_BASE_URL = "https://fmftp.net/data/disk-1/tvseries/";

const manifest = {
    id: "org.fmftp.allmovies.nuvio",
    version: "2.2.0",
    name: "FMFTP Movies & Series",
    description: "Full Catalog BDIX Streaming Addon",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["fmftp_", "tt"],
    catalogs: [
        {
            type: "movie",
            id: "fmftp_all_movies",
            name: "FMFTP Movies",
            extra: [{ name: "skip", isRequired: false }, { name: "search", isRequired: false }]
        },
        {
            type: "series",
            id: "fmftp_all_series",
            name: "FMFTP TV Series",
            extra: [{ name: "skip", isRequired: false }, { name: "search", isRequired: false }]
        }
    ]
};

const builder = new addonBuilder(manifest);

const movieCategories = ["hindidub/", "bollywood/", "hollywood/"];
const seriesCategories = ["1/", "Bangla/", "English/", "Indian/", "Turkish/", "abcd/", "korean/", "new/"];

let movieCache = [];
let seriesCache = [];
let posterCache = new Map();

function encodeId(url) {
    return "fmftp_" + Buffer.from(url).toString("base64url");
}

function decodeId(id) {
    try {
        return Buffer.from(id.replace(/^fmftp_/, ""), "base64url").toString("utf-8");
    } catch (e) {
        return "";
    }
}

function cleanTitle(raw) {
    return raw
        .replace(/\//g, "")
        .replace(/\b(1080p|720p|4k|2160p|web-dl|webrip|hdrip|bluray|x264|x265|hevc|aac|ddp5\.1|esub)\b/gi, "")
        .replace(/\(\d{4}\)/g, "")
        .replace(/\[.*?\]/g, "")
        .replace(/[\._\-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

async function fetchRealPoster(title, type) {
    if (posterCache.has(title)) return posterCache.get(title);
    if (posterCache.size > 1000) posterCache.clear();

    try {
        const clean = cleanTitle(title);
        const res = await axios.get(`https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(clean)}.json`, { timeout: 2500 });
        if (res.data && res.data.metas && res.data.metas.length > 0 && res.data.metas[0].poster) {
            const posterUrl = res.data.metas[0].poster;
            posterCache.set(title, posterUrl);
            return posterUrl;
        }
    } catch (err) {}

    const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(title)}&background=1e1e2e&color=cdd6f4&size=512&bold=true`;
    posterCache.set(title, fallback);
    return fallback;
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
        if (epOnly) e = parseInt(epOnly[1]);
    }

    return {
        id: encodeId(fileUrl),
        title: cleanFileName,
        season: s,
        episode: e,
        released: new Date().toISOString()
    };
}

// মুভি লোডার
async function loadMovies() {
    if (movieCache.length > 0) return movieCache;

    const list = [];
    for (const cat of movieCategories) {
        try {
            const catUrl = MOVIE_BASE_URL + cat;
            const response = await axios.get(catUrl, { timeout: 6000 });
            const $ = cheerio.load(response.data);

            $("a").each((i, element) => {
                const folderName = $(element).text().trim();
                const folderHref = $(element).attr("href");

                if (folderHref && folderName !== ".." && folderName !== "." && !folderHref.startsWith("?") && !folderHref.startsWith("/")) {
                    const fullUrl = catUrl + folderHref;
                    const id = encodeId(fullUrl);
                    const title = cleanTitle(folderName);
                    list.push({ id, fullUrl, cleanTitle: title, rawName: folderName, type: "movie" });
                }
            });
        } catch (err) {}
    }
    movieCache = list;
    return movieCache;
}

// সেফ টিভি সিরিজ লোডার (মেমোরি নিয়ন্ত্রণ রেখে বেশি ফোল্ডার স্ক্যান)
async function loadSeries() {
    if (seriesCache.length > 0) return seriesCache;

    const list = [];
    const seenMap = new Set();

    for (const cat of seriesCategories) {
        try {
            const catUrl = SERIES_BASE_URL + cat;
            const response = await axios.get(catUrl, { timeout: 6000 });
            const $ = cheerio.load(response.data);
            const mainFolders = [];

            $("a").each((i, el) => {
                const text = $(el).text().trim();
                const href = $(el).attr("href");
                if (href && text !== ".." && text !== "." && !href.startsWith("?") && !href.startsWith("/")) {
                    mainFolders.push(catUrl + href);
                }
            });

            // ব্যাচ প্রসেসিং: প্রতি ক্যাটাগরি থেকে ফোল্ডারগুলো স্ক্যান করা
            for (const folderUrl of mainFolders) {
                try {
                    const res = await axios.get(folderUrl, { timeout: 3500 });
                    const $f = cheerio.load(res.data);
                    let isSeriesFolder = false;

                    // ১. চেক করা এই ফোল্ডারে কি সরাসরি ভিডিও আছে?
                    $f("a").each((j, el2) => {
                        const href2 = $f(el2).attr("href");
                        if (href2 && href2.match(/\.(mp4|mkv|avi|webm)$/i)) {
                            isSeriesFolder = true;
                        }
                    });

                    if (isSeriesFolder) {
                        const parts = folderUrl.split("/").filter(Boolean);
                        const seriesName = parts[parts.length - 1];
                        const clean = cleanTitle(decodeURIComponent(seriesName));
                        const id = encodeId(folderUrl);

                        if (!seenMap.has(id) && clean.length > 0) {
                            seenMap.add(id);
                            list.push({ id, fullUrl: folderUrl, cleanTitle: clean, rawName: seriesName, type: "series" });
                        }
                    } else {
                        // ২. সাব-ফোল্ডারে (যেমন A-D/ বা Season/)-এ লুকানো সিরিজ
                        const subLinks = [];
                        $f("a").each((j, el2) => {
                            const text2 = $f(el2).text().trim();
                            const href2 = $f(el2).attr("href");
                            if (href2 && text2 !== ".." && text2 !== "." && !href2.startsWith("?") && !href2.startsWith("/")) {
                                subLinks.push(folderUrl.endsWith("/") ? folderUrl + href2 : folderUrl + "/" + href2);
                            }
                        });

                        for (const subUrl of subLinks) {
                            try {
                                const subRes = await axios.get(subUrl, { timeout: 2500 });
                                const $sub = cheerio.load(subRes.data);
                                let subIsVideo = false;

                                $sub("a").each((k, el3) => {
                                    const href3 = $sub(el3).attr("href");
                                    if (href3 && href3.match(/\.(mp4|mkv|avi|webm)$/i)) {
                                        subIsVideo = true;
                                    }
                                });

                                if (subIsVideo) {
                                    const parts = subUrl.split("/").filter(Boolean);
                                    const seriesName = parts[parts.length - 1];
                                    const clean = cleanTitle(decodeURIComponent(seriesName));
                                    const id = encodeId(subUrl);

                                    if (!seenMap.has(id) && clean.length > 0) {
                                        seenMap.add(id);
                                        list.push({ id, fullUrl: subUrl, cleanTitle: clean, rawName: seriesName, type: "series" });
                                    }
                                }
                            } catch (e) {}
                        }
                    }
                } catch (e) {}
            }
        } catch (err) {}
    }

    seriesCache = list;
    return seriesCache;
}

// ক্যাটালগ হ্যান্ডলার
builder.defineCatalogHandler(async (args) => {
    let list = args.type === "series" ? await loadSeries() : await loadMovies();

    if (args.extra && args.extra.search) {
        const query = args.extra.search.toLowerCase().trim();
        list = list.filter(m => m.cleanTitle.toLowerCase().includes(query) || m.rawName.toLowerCase().includes(query));
    }

    const skip = args.extra && args.extra.skip ? parseInt(args.extra.skip) : 0;
    const paginatedList = list.slice(skip, skip + 20);

    const metas = await Promise.all(
        paginatedList.map(async (m) => ({
            id: m.id,
            type: m.type,
            name: m.cleanTitle,
            poster: await fetchRealPoster(m.cleanTitle, m.type),
            posterShape: "poster"
        }))
    );

    return { metas };
});

// মেটা হ্যান্ডলার
builder.defineMetaHandler(async (args) => {
    const isSeries = args.type === "series";
    const list = isSeries ? await loadSeries() : await loadMovies();
    let item = list.find(m => m.id === args.id);
    let title = item ? item.cleanTitle : cleanTitle(args.id);
    let folderUrl = item ? item.fullUrl : decodeId(args.id);

    const metaObj = {
        id: args.id,
        type: args.type,
        name: title,
        genres: ["BDIX Stream"],
        poster: await fetchRealPoster(title, args.type),
        posterShape: "poster"
    };

    if (isSeries && folderUrl) {
        const videos = [];
        try {
            const rootRes = await axios.get(folderUrl, { timeout: 4000 });
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
                for (let sfIndex = 0; sfIndex < subFolders.length; sfIndex++) {
                    const sf = subFolders[sfIndex];
                    try {
                        const seasonMatch = sf.name.match(/season\s*(\d+)/i) || sf.name.match(/s(\d+)/i);
                        const sNum = seasonMatch ? parseInt(seasonMatch[1]) : (sfIndex + 1);
                        const subRes = await axios.get(sf.url, { timeout: 4000 });
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
                }
            }

            if (videos.length > 0) {
                videos.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
                metaObj.videos = videos;
            }
        } catch (err) {}
    }

    return { meta: metaObj };
});

// স্ট্রিম হ্যান্ডলার
builder.defineStreamHandler(async (args) => {
    try {
        let streamUrl = "";

        if (args.id.startsWith("tt")) {
            const imdbId = args.id.split(":")[0];
            const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/${args.type}/${imdbId}.json`, { timeout: 2500 });
            
            if (metaRes.data && metaRes.data.meta && metaRes.data.meta.name) {
                const searchTitle = metaRes.data.meta.name.toLowerCase().trim();
                const list = args.type === "series" ? await loadSeries() : await loadMovies();

                const matchedItem = list.find(m => {
                    const cTitle = m.cleanTitle.toLowerCase();
                    return cTitle.includes(searchTitle) || searchTitle.includes(cTitle);
                });

                if (matchedItem) streamUrl = matchedItem.fullUrl;
            }
        } else {
            streamUrl = decodeId(args.id);
        }

        if (!streamUrl) return { streams: [] };

        if (streamUrl.match(/\.(mp4|mkv|avi|webm)$/i)) {
            return { streams: [{ title: "▶ Play on FMFTP (BDIX Speed)", url: streamUrl }] };
        }

        const response = await axios.get(streamUrl, { timeout: 4000 });
        const $ = cheerio.load(response.data);
        let videoLink = "";

        $("a").each((i, element) => {
            const href = $(element).attr("href");
            if (href && href.match(/\.(mp4|mkv|avi|webm)$/i)) {
                videoLink = streamUrl.endsWith("/") ? streamUrl + href : streamUrl + "/" + href;
            }
        });

        if (videoLink) {
            return { streams: [{ title: "▶ Play on FMFTP (BDIX Speed)", url: videoLink }] };
        }
    } catch (error) {}

    return { streams: [] };
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
