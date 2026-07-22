const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://fmftp.net/data/disk-1/movies/";

const manifest = {
    id: "org.fmftp.allmovies.nuvio",
    version: "1.0.4",
    name: "FMFTP Movies",
    description: "Stream movies directly from FMFTP BDIX Server with real posters",
    resources: ["catalog", "meta", "stream"],
    types: ["movie"],
    catalogs: [
        {
            type: "movie",
            id: "fmftp_all_movies",
            name: "FMFTP Movies"
        }
    ]
};

const builder = new addonBuilder(manifest);
const categories = ["hindidub/", "bollywood/", "hollywood/"];

// মুভির নাম পরিষ্কার করার ফংশন (যেমন: 'Dhamaal 4 (2026)' -> 'Dhamaal 4')
function cleanMovieName(rawName) {
    return rawName
        .replace(/\/\s*$/, '')
        .replace(/\(\d{4}\)/, '') // সাল বাদ দেয়া
        .replace(/\[.*?\]/g, '')
        .trim();
}

// Cinemeta / TMDB থেকে ফ্রি আসল পোস্টার নিয়ে আসার ফংশন
async function fetchRealPoster(cleanName) {
    try {
        const searchUrl = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(cleanName)}.json`;
        const res = await axios.get(searchUrl, { timeout: 3000 });
        if (res.data && res.data.metas && res.data.metas.length > 0) {
            return res.data.metas[0].poster; // আসল অফিশিয়াল সিনেমার পোস্টার
        }
    } catch (err) {
        // এরর হলে ফলব্যাক পোস্টার
    }
    return `https://via.placeholder.com/300x450/1e1e2e/ffffff.png?text=${encodeURIComponent(cleanName)}`;
}

// ১. ক্যাটালগ হ্যান্ডলার
builder.defineCatalogHandler(async (args) => {
    let allMovies = [];

    try {
        for (const cat of categories) {
            const catUrl = BASE_URL + cat;
            const response = await axios.get(catUrl);
            const $ = cheerio.load(response.data);

            const moviePromises = [];

            $("a").each((i, element) => {
                const folderName = $(element).text().trim();
                const folderHref = $(element).attr("href");

                if (folderHref) {
                    const rawName = folderName.replace(/\//g, "").trim();

                    if (
                        rawName && 
                        rawName !== ".." && 
                        rawName !== "." && 
                        !folderHref.startsWith("?") && 
                        !folderHref.startsWith("/")
                    ) {
                        const fullPath = catUrl + folderHref;
                        const cleanedName = cleanMovieName(rawName);

                        // প্রতিটি মুভির জন্য অফিশিয়াল পোস্টার খোঁজার প্রসেস
                        const p = fetchRealPoster(cleanedName).then((posterUrl) => {
                            return {
                                id: "fmftp_" + encodeURIComponent(fullPath),
                                type: "movie",
                                name: rawName,
                                poster: posterUrl
                            };
                        });

                        moviePromises.push(p);
                    }
                }
            });

            const moviesInCat = await Promise.all(moviePromises);
            allMovies = allMovies.concat(moviesInCat);
        }
        return { metas: allMovies };
    } catch (error) {
        console.error("Error fetching catalog:", error);
        return { metas: [] };
    }
});

// ২. মেটা হ্যান্ডলার
builder.defineMetaHandler(async (args) => {
    const folderUrl = decodeURIComponent(args.id.replace("fmftp_", ""));
    const pathParts = folderUrl.split("/").filter(Boolean);
    const rawName = decodeURIComponent(pathParts[pathParts.length - 1] || "Movie");
    const cleanedName = cleanMovieName(rawName);

    const posterUrl = await fetchRealPoster(cleanedName);

    return {
        meta: {
            id: args.id,
            type: "movie",
            name: rawName,
            poster: posterUrl,
            description: "Direct BDIX Stream from FMFTP Server"
        }
    };
});

// ৩. স্ট্রিম হ্যান্ডলার
builder.defineStreamHandler(async (args) => {
    try {
        const folderUrl = decodeURIComponent(args.id.replace("fmftp_", ""));
        const response = await axios.get(folderUrl);
        const $ = cheerio.load(response.data);
        let videoLink = "";

        $("a").each((i, element) => {
            const href = $(element).attr("href");
            if (href && (href.endsWith(".mp4") || href.endsWith(".mkv"))) {
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
    } catch (error) {
        console.error("Error fetching stream:", error);
    }

    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
