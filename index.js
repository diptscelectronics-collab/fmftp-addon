const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://fmftp.net/data/disk-1/movies/";

const manifest = {
    id: "org.fmftp.allmovies.nuvio",
    version: "1.1.2",
    name: "FMFTP Movies",
    description: "Fast BDIX Movie Streaming Addon",
    resources: ["catalog", "meta", "stream"],
    types: ["movie"],
    // এটি যোগ করায় Stremio বুঝতে পারবে এই আইডিগুলো আমাদের অ্যাডঅনের
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
        }
    ]
};

const builder = new addonBuilder(manifest);
const categories = ["hindidub/", "bollywood/", "hollywood/"];

const movieMap = new Map();
let lastCacheTime = 0;

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

async function loadMovies() {
    if (movieMap.size > 0 && (Date.now() - lastCacheTime < 3600000)) {
        return Array.from(movieMap.values());
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
                        const id = encodeId(fullUrl);
                        const cleanTitle = cleanName(nameClean);
                        
                        const item = {
                            id: id,
                            fullUrl: fullUrl,
                            rawName: nameClean,
                            cleanTitle: cleanTitle,
                            poster: `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanTitle)}&background=181825&color=cdd6f4&size=512&bold=true`
                        };
                        
                        movieMap.set(id, item);
                        all.push(item);
                    }
                }
            });
        }
        lastCacheTime = Date.now();
    } catch (e) {
        console.error("FTP Fetch Error:", e.message);
    }
    return Array.from(movieMap.size ? movieMap.values() : []);
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
        if (!m.poster.includes("cinemeta")) {
            try {
                const searchUrl = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(m.cleanTitle)}.json`;
                const res = await axios.get(searchUrl, { timeout: 1200 });
                if (res.data && res.data.metas && res.data.metas.length > 0) {
                    m.poster = res.data.metas[0].poster;
                    movieMap.set(m.id, m);
                }
            } catch (err) {}
        }

        return {
            id: m.id,
            type: "movie",
            name: m.cleanTitle,
            poster: m.poster,
            posterShape: "poster"
        };
    }));

    return { metas: metas };
});

// ২. মেটা হ্যান্ডলার (Stremio-Strict Meta Schema)
builder.defineMetaHandler(async (args) => {
    let item = movieMap.get(args.id);
    
    let title = "Movie";
    let poster = "";
    
    if (item) {
        title = item.cleanTitle;
        poster = item.poster;
    } else {
        const folderUrl = decodeId(args.id);
        const pathParts = folderUrl.split("/").filter(Boolean);
        const rawName = decodeURIComponent(pathParts[pathParts.length - 1] || "Movie");
        title = cleanName(rawName);
        poster = `https://ui-avatars.com/api/?name=${encodeURIComponent(title)}&background=181825&color=cdd6f4&size=512&bold=true`;
    }

    return {
        meta: {
            id: args.id,
            type: "movie",
            name: title,
            genres: ["BDIX Stream", "Movies"],
            poster: poster,
            posterShape: "poster",
            background: poster,
            description: `Direct High-Speed BDIX Stream from FMFTP Server.\n\nMovie Title: ${title}`
        }
    };
});

// ৩. স্ট্রিম হ্যান্ডলার
builder.defineStreamHandler(async (args) => {
    try {
        const item = movieMap.get(args.id);
        const folderUrl = item ? item.fullUrl : decodeId(args.id);
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
