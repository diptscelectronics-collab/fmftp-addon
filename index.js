const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const MOVIE_BASE_URL = "https://fmftp.net/data/disk-1/movies/";
const SERIES_BASE_URL = "https://fmftp.net/data/disk-1/tvseries/";

const manifest = {
    id: "org.fmftp.allmovies.nuvio",
    version: "1.5.0",
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
const seriesCategories = ["english/", "bangla/", "hindi/", "korean/", ""];

const movieMap = new Map();
const seriesMap = new Map();
const posterCache = new Map();

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

// নাম পরিষ্কার করার জন্য শক্তিশালী ফাংশন
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

// আসল পোস্টার খোজার ফাংশন (Cinemeta API)
async function fetchRealPoster(title, type) {
    if (posterCache.has(title)) return posterCache.get(title);

    try {
        const clean = cleanTitle(title);
        const res = await axios.get(`https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(clean)}.json`, { timeout: 3000 });
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

async function loadMovies() {
    if (movieMap.size > 0) return Array.from(movieMap.values());
    for (const cat of movieCategories) {
        try {
            const response = await axios.get(MOVIE_BASE_URL + cat, { timeout: 15000 });
            const $ = cheerio.load(response.data);
            $("a").each((i, element) => {
                const folderName = $(element).text().trim();
                const folderHref = $(element).attr("href");
                if (folderHref && folderName !== ".." && folderName !== "." && !folderHref.startsWith("?") && !folderHref.startsWith("/")) {
                    const fullUrl = MOVIE_BASE_URL + cat + folderHref;
                    const id = encodeId(fullUrl);
                    const title = cleanTitle(folderName);
                    movieMap.set(id, { id, fullUrl, cleanTitle: title, rawName: folderName, type: "movie" });
                }
            });
        } catch (err) {}
    }
    return Array.from(movieMap.values());
}

async function loadSeries() {
    if (seriesMap.size > 0) return Array.from(seriesMap.values());
    for (const cat of seriesCategories) {
        try {
            const response = await axios.get(SERIES_BASE_URL + cat, { timeout: 15000 });
            const $ = cheerio.load(response.data);
            $("a").each((i, element) => {
                const folderName = $(element).text().trim();
                const folderHref = $(element).attr("href");
                if (folderHref && folderName !== ".." && folderName !== "." && !folderHref.startsWith("?") && !folderHref.startsWith("/")) {
                    const fullUrl = SERIES_BASE_URL + cat + folderHref;
                    const id = encodeId(fullUrl);
                    const title = cleanTitle(folderName);
                    seriesMap.set(id, { id, fullUrl, cleanTitle: title, rawName: folderName, type: "series" });
                }
            });
        } catch (err) {}
    }
    return Array.from(seriesMap.values());
}

// ১. ক্যাটালগ হ্যান্ডলার
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

// ২. মেটা হ্যান্ডলার
builder.defineMetaHandler(async (args) => {
    const isSeries = args.type === "series";
    let item = isSeries ? seriesMap.get(args.id) : movieMap.get(args.id);
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
            const rootRes = await axios.get(folderUrl, { timeout: 5000 });
            const $ = cheerio.load(rootRes.data);
            let epCount = 1;

            $("a").each((i, el) => {
                const href = $(el).attr("href");
                const name = $(el).text().trim();
                if (href && name !== ".." && name !== "." && !href.startsWith("?")) {
                    const fullHref = folderUrl.endsWith("/") ? folderUrl + href : folderUrl + "/" + href;
                    if (href.match(/\.(mp4|mkv|avi|webm)$/i)) {
                        videos.push(buildVideoObject(fullHref, name, 1, epCount++));
                    }
                }
            });
            if (videos.length > 0) metaObj.videos = videos;
        } catch (err) {}
    }

    return { meta: metaObj };
});

// ৩. স্মার্ট স্ট্রিমিং হ্যান্ডলার (Search Matching Fix)
builder.defineStreamHandler(async (args) => {
    try {
        let streamUrl = "";

        if (args.id.startsWith("tt")) {
            const imdbId = args.id.split(":")[0];
            const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/${args.type}/${imdbId}.json`, { timeout: 3000 });
            
            if (metaRes.data && metaRes.data.meta && metaRes.data.meta.name) {
                const searchTitle = metaRes.data.meta.name.toLowerCase().trim();
                const list = args.type === "series" ? await loadSeries() : await loadMovies();

                // নামের ফ্লেক্সিবল ম্যাচিং
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
            return { streams: [{ title: "▶ Play on FMFTP (BDIX Speed)", url: videoLink }] };
        }
    } catch (error) {}

    return { streams: [] };
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
