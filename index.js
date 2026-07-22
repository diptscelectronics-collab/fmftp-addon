const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://fmftp.net/data/disk-1/movies/";

const manifest = {
    id: "org.fmftp.allmovies.nuvio",
    version: "1.0.8",
    name: "FMFTP Movies",
    description: "Stream movies directly from FMFTP with Real Posters",
    resources: ["catalog", "meta", "stream"],
    types: ["movie"],
    catalogs: [
        {
            type: "movie",
            id: "fmftp_all_movies",
            name: "FMFTP Movies",
            // পেজিনেশন এবং সার্চ অপশন চালু করা হলো
            extra: [
                { name: "skip", isRequired: false },
                { name: "search", isRequired: false }
            ]
        }
    ]
};

const builder = new addonBuilder(manifest);
const categories = ["hindidub/", "bollywood/", "hollywood/"];

// সার্ভার ফাস্ট রাখার জন্য মেমোরি ক্যাশ
let movieCache = [];
let lastCacheTime = 0;

function cleanName(raw) {
    return raw.replace(/\//g, "").replace(/\(\d{4}\)/g, "").replace(/\[.*?\]/g, "").trim();
}

// এফটিপি থেকে মুভির লিস্ট লোড করার ফাংশন
async function loadMovies() {
    if (movieCache.length > 0 && (Date.now() - lastCacheTime < 3600000)) {
        return movieCache; // ১ ঘন্টার জন্য ক্যাশ করা থাকবে, তাই লোডিং হবে রকেটের মত ফাস্ট!
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

// ১. ক্যাটালগ হ্যান্ডলার (আসল পোস্টার ও পেজিনেশন সহ)
builder.defineCatalogHandler(async (args) => {
    let list = await loadMovies();

    // যদি ইউজার সার্চ করে
    if (args.extra && args.extra.search) {
        const query = args.extra.search.toLowerCase();
        list = list.filter(m => m.cleanTitle.toLowerCase().includes(query));
    }

    // পেজিনেশন: একবারে শুধুমাত্র ৩০টি মুভি লোড করবে
    const skip = args.extra && args.extra.skip ? parseInt(args.extra.skip) : 0;
    const limit = 30; 
    const paginatedList = list.slice(skip, skip + limit);

    // এই ৩০টি মুভির জন্য আসল পোস্টার ফেচ করবে
    const metas = await Promise.all(paginatedList.map(async (m) => {
        let posterUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(m.cleanTitle)}&background=181825&color=cdd6f4&size=512&bold=true`;
        
        try {
            const searchUrl = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(m.cleanTitle)}.json`;
            const res = await axios.get(searchUrl, { timeout: 2500 });
            if (res.data && res.data.metas && res.data.metas.length > 0) {
                posterUrl = res.data.metas[0].poster; // আসল পোস্টার পেয়ে গেলে সেটা বসিয়ে দিবে
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

// ২. মেটা হ্যান্ডলার (ক্লিক করলে ডিটেইলস আনবে)
builder.defineMetaHandler(async (args) => {
    try {
        const folderUrl = decodeURIComponent(args.id.replace("fmftp_", ""));
        const pathParts = folderUrl.split("/").filter(Boolean);
        const rawName = decodeURIComponent(pathParts[pathParts.length - 1] || "Movie");
        const cleaned = cleanName(rawName);

        let posterUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(cleaned)}&background=181825&color=cdd6f4&size=512&bold=true`;
        let description = `Direct BDIX Stream from FMFTP Server. Movie: ${cleaned}`;
        let backgroundUrl = posterUrl;
        let imdbRating = null;
        let releaseYear = null;

        try {
            const searchUrl = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(cleaned)}.json`;
            const res = await axios.get(searchUrl, { timeout: 3000 });
            if (res.data && res.data.metas && res.data.metas.length > 0) {
                const metaData = res.data.metas[0];
                posterUrl = metaData.poster || posterUrl;
                backgroundUrl = metaData.background || backgroundUrl;
                description = metaData.description || description;
                imdbRating = metaData.imdbRating || null;
                releaseYear = metaData.year || null;
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
                imdbRating: imdbRating,
                releaseInfo: releaseYear
            }
        };
    } catch (e) {
        return { meta: null };
    }
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
            // mp4, mkv, avi সব ধরণের ফরম্যাট সাপোর্ট করবে
            if (href && (href.match(/\.(mp4|mkv|avi|webm)$/i))) {
                videoLink = folderUrl + href;
            }
        });

        if (videoLink) {
            return {
                streams: [
                    {
                        title: "FMFTP Direct BDIX Stream",
                        url: videoLink
                    }
                ]
            };
        }
    } catch (error) {}

    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
