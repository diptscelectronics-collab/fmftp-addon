const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://fmftp.net/data/disk-1/movies/";

const manifest = {
    id: "org.fmftp.allmovies.nuvio",
    version: "1.1.0",
    name: "FMFTP Movies",
    description: "Stream movies directly from FMFTP with Real Posters",
    resources: ["catalog", "meta", "stream"],
    types: ["movie"],
    catalogs: [
        {
            type: "movie",
            id: "fmftp_all_movies",
            name: "FMFTP Movies",
            extra: [
                { name: "skip", isRequired: false },
                { name: "search", isRequired: false }
            ]
        }
    ]
};

const builder = new addonBuilder(manifest);
const categories = ["hindidub/", "bollywood/", "hollywood/"];

let movieCache = [];
let lastCacheTime = 0;

// URL-safe Base64 Helper Functions (404 Error চিরতরে বন্ধ করার জন্য)
function encodeId(url) {
    return "fmftp_" + Buffer.from(url).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeId(id) {
    try {
        let base64 = id.replace(/^fmftp_/, "").replace(/-/g, "+").replace(/_/g, "/");
        while (base64.length % 4 !== 0) {
            base64 += "=";
        }
        return Buffer.from(base64, "base64").toString("utf-8");
    } catch (e) {
        return "";
    }
}

function cleanName(raw) {
    return raw.replace(/\//g, "").replace(/\(\d{4}\)/g, "").replace(/\[.*?\]/g, "").trim();
}

async function loadMovies() {
    if (movieCache.length > 0 && (Date.now() - lastCacheTime < 3600000)) {
        return movieCache;
    }
    
    let all = [];
    try {
        for (const cat of categories) {
            const catUrl = BASE_URL + cat;
            const response = await axios.get(catUrl, { timeout: 15000 });
            const $ = cheerio.load(response.data);

            $("a").each((i, element) => {
                const folderName = $(element).text().trim();
                const folderHref = $(element).attr("href");

                if (folderHref) {
                    const nameClean = folderName.replace(/\//g, "").trim();
                    if (nameClean && nameClean !== ".." && nameClean !== "." && !folderHref.startsWith("?") && !folderHref.startsWith("/")) {
                        const fullUrl = catUrl + folderHref;
                        all.push({
                            id: encodeId(fullUrl),
                            rawName: nameClean,
                            cleanTitle: cleanName(nameClean)
                        });
                    }
                }
            });
        }
        movieCache = all;
        lastCacheTime = Date.now();
    } catch (e) {
        console.error("FTP Fetch Error:", e.message);
    }
    return movieCache;
}

// ১. ক্যাটালগ হ্যান্ডলার
builder.defineCatalogHandler(async (args) => {
    let list = await loadMovies();

    if (args.extra && args.extra.search) {
        const query = args.extra.search.toLowerCase();
        list = list.filter(m => m.cleanTitle.toLowerCase().includes(query));
    }

    const skip = args.extra && args.extra.skip ? parseInt(args.extra.skip) : 0;
    const limit = 30; 
    const paginatedList = list.slice(skip, skip + limit);

    const metas = await Promise.all(paginatedList.map(async (m) => {
        let posterUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(m.cleanTitle)}&background=181825&color=cdd6f4&size=512&bold=true`;
        
        try {
            const searchUrl = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(m.cleanTitle)}.json`;
            const res = await axios.get(searchUrl, { timeout: 1500 });
            if (res.data && res.data.metas && res.data.metas.length > 0) {
                posterUrl = res.data.metas[0].poster;
            }
        } catch (err) {}

        return {
            id: m.id,
            type: "movie",
            name: m.cleanTitle,
            poster: posterUrl
        };
    }));

    return { metas: metas };
});

// ২. মেটা হ্যান্ডলার (Base64 ডিকোড সহ শতভাগ ফেইল-সেফ)
builder.defineMetaHandler(async (args) => {
    const folderUrl = decodeId(args.id);
    const pathParts = folderUrl.split("/").filter(Boolean);
    const rawName = decodeURIComponent(pathParts[pathParts.length - 1] || "Movie");
    const cleaned = cleanName(rawName);

    let posterUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(cleaned)}&background=181825&color=cdd6f4&size=512&bold=true`;
    let description = `Direct High-Speed BDIX Stream from FMFTP Server.\n\nMovie Name: ${cleaned}`;
    let backgroundUrl = posterUrl;
    let releaseYear = "N/A";

    try {
        const searchUrl = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(cleaned)}.json`;
        const res = await axios.get(searchUrl, { timeout: 1500 });
        if (res.data && res.data.metas && res.data.metas.length > 0) {
            const metaData = res.data.metas[0];
            posterUrl = metaData.poster || posterUrl;
            backgroundUrl = metaData.background || backgroundUrl;
            description = metaData.description || description;
            releaseYear = metaData.year || releaseYear;
        }
    } catch (e) {}

    return {
        meta: {
            id: args.id,
            type: "movie",
            name: cleaned,
            genres: ["BDIX Stream", "Movies"],
            poster: posterUrl,
            background: backgroundUrl,
            description: description,
            releaseInfo: releaseYear
        }
    };
});

// ৩. স্ট্রিম হ্যান্ডলার
builder.defineStreamHandler(async (args) => {
    try {
        const folderUrl = decodeId(args.id);
        if (!folderUrl) return { streams: [] };

        const response = await axios.get(folderUrl, { timeout: 10000 });
        const $ = cheerio.load(response.data);
        let videoLink = "";

        $("a").each((i, element) => {
            const href = $(element).attr("href");
            if (href && (href.match(/\.(mp4|mkv|avi|webm)$/i))) {
                videoLink = folderUrl + href;
            }
        });

        if (videoLink) {
            return {
                streams: [
                    {
                        title: "▶ Play on FMFTP (BDIX Speed)",
                        url: videoLink
                    }
                ]
            };
        }
    } catch (error) {}

    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
