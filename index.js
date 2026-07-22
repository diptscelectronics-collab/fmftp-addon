const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://fmftp.net/data/disk-1/movies/";

const manifest = {
    id: "org.fmftp.allmovies.nuvio",
    version: "1.0.9",
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
                        all.push({
                            id: "fmftp_" + encodeURIComponent(catUrl + folderHref),
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
            const res = await axios.get(searchUrl, { timeout: 2000 });
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

// ২. মেটা হ্যান্ডলার (Bulletproof - কোনোভাবেই আর ফেইল করবে না)
builder.defineMetaHandler(async (args) => {
    let folderUrl = "";
    try {
        folderUrl = decodeURIComponent(args.id.replace("fmftp_", ""));
    } catch(e) {
        folderUrl = "Unknown";
    }

    const pathParts = folderUrl.split("/").filter(Boolean);
    const rawName = decodeURIComponent(pathParts[pathParts.length - 1] || "Movie");
    const cleaned = cleanName(rawName);

    // ডিফল্ট ডাটা রেডি রাখা হচ্ছে
    let posterUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(cleaned)}&background=181825&color=cdd6f4&size=512&bold=true`;
    let description = `Direct BDIX Stream from FMFTP Server.\n\nEnjoy bufferless streaming for: ${cleaned}`;
    let backgroundUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(cleaned)}&background=181825&color=cdd6f4&size=1024&bold=true`;
    let releaseYear = "N/A";

    try {
        // চেষ্টা করবে আসল পোস্টার/ব্যাকগ্রাউন্ড আনার
        const searchUrl = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(cleaned)}.json`;
        const res = await axios.get(searchUrl, { timeout: 1500 });
        if (res.data && res.data.metas && res.data.metas.length > 0) {
            const metaData = res.data.metas[0];
            posterUrl = metaData.poster || posterUrl;
            backgroundUrl = metaData.background || backgroundUrl;
            description = metaData.description || description;
            releaseYear = metaData.year || releaseYear;
        }
    } catch (e) {
        // টাইমআউট বা ফেইল হলে কিছুই করবে না, শুধু ডিফল্ট ডাটা পাঠিয়ে দেবে
    }

    // সবসময় একটি ভ্যালিড মেটা অবজেক্ট রিটার্ন করবে, ফলে বিড়াল আর আসবে না!
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
        const folderUrl = decodeURIComponent(args.id.replace("fmftp_", ""));
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
