const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const MOVIE_BASE_URL = "https://fmftp.net/data/disk-1/movies/";
const SERIES_BASE_URL = "https://fmftp.net/data/disk-1/tvseries/";

const manifest = {
    id: "org.fmftp.allmovies.nuvio",
    version: "1.2.0",
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

// URL-Safe Base64 Helpers
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

// ১. মুভি লোড ফাংশন
async function loadMovies() {
    if (movieMap.size > 0 && (Date.now() - lastMovieCacheTime < 3600000)) {
        return Array.from(movieMap.values());
    }
    
    try {
        for (const cat of movieCategories) {
            const catUrl = MOVIE_BASE_URL + cat;
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
        }
        lastMovieCacheTime = Date.now();
    } catch (e) {
        console.error("Movie Fetch Error:", e.message);
    }
    return Array.from(movieMap.values());
}

// ২. টিভি সিরিজ লোড ফাংশন
async function loadSeries() {
    if (seriesMap.size > 0 && (Date.now() - lastSeriesCacheTime < 3600000)) {
        return Array.from(seriesMap.values());
    }
    
    try {
        for (const cat of seriesCategories) {
            const catUrl = SERIES_BASE_URL + cat;
            try {
                const response = await axios.get(catUrl, { timeout: 10000 });
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
    } catch (e) {
        console.error("Series Fetch Error:", e.message);
    }
    return Array.from(seriesMap.values());
}

// ৩. ক্যাটালগ হ্যান্ডলার (Movies & Series)
builder.defineCatalogHandler(async (args) => {
    let list = args.type === "series" ? await loadSeries() : await loadMovies();

    if (args.extra && args.extra.search) {
        const query = args.extra.search.toLowerCase();
        list = list.filter(m => m.cleanTitle.toLowerCase().includes(query));
    }

    const skip = args.extra && args.extra.skip ? parseInt(args.extra.skip) : 0;
    const limit = 30; 
    const paginatedList = list.slice(skip, skip + limit);

    const metas = await Promise.all(paginatedList.map(async (m) => {
        if (!m.poster.includes("cinemeta")) {
            try {
                const searchUrl = `https://v3-cinemeta.strem.io/catalog/${m.type}/top/search=${encodeURIComponent(m.cleanTitle)}.json`;
                const res = await axios.get(searchUrl, { timeout: 1200 });
                if (res.data && res.data.metas && res.data.metas.length > 0) {
                    m.poster = res.data.metas[0].poster;
                    if (m.type === "movie") movieMap.set(m.id, m);
                    else seriesMap.set(m.id, m);
                }
            } catch (err) {}
        }

        return {
            id: m.id,
            type: m.type,
            name: m.cleanTitle,
            poster: m.poster,
            posterShape: "poster"
        };
    }));

    return { metas: metas };
});

// ৪. মেটা হ্যান্ডলার (সিরিজের সিজন ও এপিসোড বের করার লজিক সহ)
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

    // যদি টিভি সিরিজ হয়, তাহলে ফোল্ডার স্ক্যান করে সব সিজন ও এপিসোড বের করা হবে
    if (isSeries && folderUrl) {
        const videos = [];
        try {
            async function scanFolder(url, defaultSeason = 1) {
                const res = await axios.get(url, { timeout: 8000 });
                const $ = cheerio.load(res.data);
                let epCount = 1;

                const links = [];
                $("a").each((i, el) => {
                    const href = $(el).attr("href");
                    const name = $(el).text().trim();
                    if (href && name !== ".." && name !== "." && !href.startsWith("?") && !href.startsWith("/")) {
                        links.push({ href: url + href, name: name });
                    }
                });

                for (const link of links) {
                    if (link.href.match(/\.(mp4|mkv|avi|webm)$/i)) {
                        // S01E02 বা Episode সংখ্যা ডিটেক্ট করার লজিক
                        const match = link.name.match(/s(\d+)e(\d+)/i) || link.name.match(/(\d+)x(\d+)/i);
                        let s = defaultSeason;
                        let e = epCount;

                        if (match) {
                            s = parseInt(match[1]);
                            e = parseInt(match[2]);
                        } else {
                            const epMatch = link.name.match(/e(?:pisode)?\s*(\d+)/i);
                            if (epMatch) e = parseInt(epMatch[1]);
                        }

                        videos.push({
                            id: encodeId(link.href), // সরাসরি ভিডিও ফাইল লিংক এনকোড করা হলো
                            title: link.name.replace(/\.[^/.]+$/, ""),
                            season: s,
                            episode: e,
                            released: new Date().toISOString()
                        });
                        epCount++;
                    } else if (link.href.endsWith("/")) {
                        // সিজন ফোল্ডার থাকলে (যেমন: Season 1)
                        const seasonMatch = link.name.match(/season\s*(\d+)/i) || link.name.match(/s(\d+)/i);
                        const foundSeason = seasonMatch ? parseInt(seasonMatch[1]) : defaultSeason;
                        await scanFolder(link.href, foundSeason);
                    }
                }
            }

            await scanFolder(folderUrl);
            if (videos.length > 0) {
                metaObj.videos = videos;
            }
        } catch (err) {
            console.error("Error parsing series episodes:", err.message);
        }
    }

    return { meta: metaObj };
});

// ৫. স্ট্রিম হ্যান্ডলার
builder.defineStreamHandler(async (args) => {
    try {
        const decodedUrl = decodeId(args.id);
        if (!decodedUrl) return { streams: [] };

        // যদি সরাসরি ভিডিও ফাইলের লিংক হয় (টিভি সিরিজের জন্য)
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

        // যদি ফোল্ডারের লিংক হয় (মুভির জন্য)
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

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
