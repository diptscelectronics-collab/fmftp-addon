const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const MOVIE_BASE_URL = "https://fmftp.net/data/disk-1/movies/";
const SERIES_BASE_URL = "https://fmftp.net/data/disk-1/tvseries/";

const manifest = {
    id: "org.fmftp.allmovies.nuvio",
    version: "1.2.2",
    name: "FMFTP Movies & Series",
    description: "Fast BDIX Movie & TV Series Streaming Addon",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["fmftp_"], 
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
        console.log("Fetching movies from FMFTP...");
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
                            
                            const item = {
                                id: id,
                                fullUrl: fullUrl,
                                cleanTitle: cleanTitle,
                                type: "movie",
                                poster: `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanTitle)}&background=181825&color=cdd6f4&size=512&bold=true`
                            };
                            movieMap.set(id, item);
                        }
                    }
                });
            } catch (err) {}
        }
        lastMovieCacheTime = Date.now();
        console.log(`Loaded ${movieMap.size} movies to cache.`);
    } catch (e) {
        console.error("Movie Fetch Error:", e.message);
    }
    return Array.from(movieMap.values());
}

async function loadSeries() {
    if (seriesMap.size > 0 && (Date.now() - lastSeriesCacheTime < 3600000)) {
        return Array.from(seriesMap.values());
    }
    
    try {
        console.log("Fetching series from FMFTP...");
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
                            
                            const item = {
                                id: id,
                                fullUrl: fullUrl,
                                cleanTitle: cleanTitle,
                                type: "series",
                                poster: `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanTitle)}&background=1e1e2e&color=a6e3a1&size=512&bold=true`
                            };
                            seriesMap.set(id, item);
                        }
                    }
                });
            } catch (err) {}
        }
        lastSeriesCacheTime = Date.now();
        console.log(`Loaded ${seriesMap.size} TV series to cache.`);
    } catch (e) {
        console.error("Series Fetch Error:", e.message);
    }
    return Array.from(seriesMap.values());
}

// ১. ক্যাটালগ হ্যান্ডলার (ইনস্ট্যান্ট সার্চ সাপোর্টের জন্য অপটিমাইজড)
builder.defineCatalogHandler(async (args) => {
    let list = args.type === "series" ? await loadSeries() : await loadMovies();

    if (args.extra && args.extra.search) {
        const query = args.extra.search.toLowerCase().trim();
        list = list.filter(m => m.cleanTitle.toLowerCase().includes(query));
    }

    const skip = args.extra && args.extra.skip ? parseInt(args.extra.skip) : 0;
    const limit = 30; 
    const paginatedList = list.slice(skip, skip + limit);

    const metas = paginatedList.map((m) => {
        return {
            id: m.id,
            type: m.type,
            name: m.cleanTitle,
            poster: m.poster,
            posterShape: "poster"
        };
    });

    return { metas: metas };
});

// ২. মেটা হ্যান্ডলার 
builder.defineMetaHandler(async (args) => {
    const isSeries = args.type === "series";
    let item = isSeries ? seriesMap.get(args.id) : movieMap.get(args.id);
    
    let title = "Item";
    let poster = "";
    let folderUrl = "";

    if (item) {
        title = item.cleanTitle;
        poster = item.poster;
        folderUrl = item.fullUrl;
    } else {
        folderUrl = decodeId(args.id);
        const pathParts = folderUrl.split("/").filter(Boolean);
        const rawName = decodeURIComponent(pathParts[pathParts.length - 1] || "Item");
        title = cleanName(rawName);
        poster = `https://ui-avatars.com/api/?name=${encodeURIComponent(title)}&background=181825&color=cdd6f4&size=512&bold=true`;
    }

    const metaObj = {
        id: args.id,
        type: args.type,
        name: title,
        genres: ["BDIX Stream", isSeries ? "TV Series" : "Movies"],
        poster: poster,
        posterShape: "poster",
        background: poster,
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
        } catch (err) {
            console.error("Error parsing series episodes:", err.message);
        }
    }

    return { meta: metaObj };
});

// ৩. স্ট্রিম হ্যান্ডলার
builder.defineStreamHandler(async (args) => {
    try {
        const decodedUrl = decodeId(args.id);
        if (!decodedUrl) return { streams: [] };

        if (decodedUrl.match(/\.(mp4|mkv|avi|webm)$/i)) {
            return {
                streams: [
                    {
                        title: "▶ Play Episode on FMFTP (BDIX Speed)",
                        url: decodedUrl
                    }
                ]
            };
        }

        const response = await axios.get(decodedUrl, { timeout: 10000 });
        const $ = cheerio.load(response.data);
        let videoLink = "";

        $("a").each((i, element) => {
            const href = $(element).attr("href");
            if (href && (href.match(/\.(mp4|mkv|avi|webm)$/i))) {
                videoLink = decodedUrl + href;
            }
        });

        if (videoLink) {
            return {
                streams: [
                    {
                        title: "▶ Play Movie on FMFTP (BDIX Speed)",
                        url: videoLink
                    }
                ]
            };
        }
    } catch (error) {}

    return { streams: [] };
});

// সার্ভার স্টার্ট
const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });

console.log(`Addon running at http://localhost:${PORT}/manifest.json`);

// ব্যাকগ্রাউন্ডে ডাটা ইনডেক্স করা (ইনস্ট্যান্ট সার্চের জন্য)
loadMovies();
loadSeries();
