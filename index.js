const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://fmftp.net/data/disk-1/movies/";

const manifest = {
    id: "org.fmftp.allmovies.nuvio",
    version: "1.0.3",
    name: "FMFTP Movies",
    description: "Stream movies directly from FMFTP BDIX Server",
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

// পোস্টার তৈরির সহজ ও নির্ভরযোগ্য ফংশন
function getPosterUrl(movieName) {
    // পোস্টারের ছবি দ্রুত লোড হওয়ার জন্য UI Avatars API
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(movieName)}&background=1e1e2e&color=ffffff&size=512&font-size=0.33&bold=true`;
}

// ১. ক্যাটালগ হ্যান্ডলার
builder.defineCatalogHandler(async (args) => {
    let allMovies = [];

    try {
        for (const cat of categories) {
            const catUrl = BASE_URL + cat;
            const response = await axios.get(catUrl);
            const $ = cheerio.load(response.data);

            $("a").each((i, element) => {
                const folderName = $(element).text().trim();
                const folderHref = $(element).attr("href");

                if (folderHref) {
                    const cleanName = folderName.replace(/\//g, "").trim();

                    if (
                        cleanName && 
                        cleanName !== ".." && 
                        cleanName !== "." && 
                        !folderHref.startsWith("?") && 
                        !folderHref.startsWith("/")
                    ) {
                        const fullPath = catUrl + folderHref;

                        allMovies.push({
                            id: "fmftp_" + encodeURIComponent(fullPath),
                            type: "movie",
                            name: decodeURIComponent(cleanName),
                            poster: getPosterUrl(cleanName)
                        });
                    }
                }
            });
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

    return {
        meta: {
            id: args.id,
            type: "movie",
            name: rawName,
            poster: getPosterUrl(rawName),
            description: "Direct BDIX Stream from FMFTP: " + rawName
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
