const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://fmftp.net/data/disk-1/movies/";

const manifest = {
    id: "org.fmftp.allmovies.nuvio",
    version: "1.0.7",
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

// নাম ক্লিন করার ফংশন
function cleanName(raw) {
    return raw.replace(/\//g, "").replace(/\(\d{4}\)/g, "").trim();
}

// ১. ক্যাটালগ হ্যান্ডলার
builder.defineCatalogHandler(async () => {
    let allMovies = [];

    try {
        for (const cat of categories) {
            const catUrl = BASE_URL + cat;
            const response = await axios.get(catUrl, { timeout: 10000 });
            const $ = cheerio.load(response.data);

            $("a").each((i, element) => {
                const folderName = $(element).text().trim();
                const folderHref = $(element).attr("href");

                if (folderHref) {
                    const nameClean = folderName.replace(/\//g, "").trim();

                    if (
                        nameClean && 
                        nameClean !== ".." && 
                        nameClean !== "." && 
                        !folderHref.startsWith("?") && 
                        !folderHref.startsWith("/")
                    ) {
                        const fullPath = catUrl + folderHref;
                        const displayTitle = cleanName(nameClean);

                        allMovies.push({
                            id: "fmftp_" + encodeURIComponent(fullPath),
                            type: "movie",
                            name: displayTitle,
                            poster: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayTitle)}&background=1e1e2e&color=cdd6f4&size=512&bold=true`
                        });
                    }
                }
            });
        }
        return { metas: allMovies };
    } catch (error) {
        console.error("Error fetching catalog:", error.message);
        return { metas: [] };
    }
});

// ২. মেটা হ্যান্ডলার (স্ট্রিমিওর স্ট্যান্ডার্ড স্ট্রাকচার অনুযায়ী আপডেট করা)
builder.defineMetaHandler(async (args) => {
    try {
        const folderUrl = decodeURIComponent(args.id.replace("fmftp_", ""));
        const pathParts = folderUrl.split("/").filter(Boolean);
        const rawName = decodeURIComponent(pathParts[pathParts.length - 1] || "Movie");
        const cleaned = cleanName(rawName);

        const posterUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(cleaned)}&background=1e1e2e&color=cdd6f4&size=512&bold=true`;

        return {
            meta: {
                id: args.id,
                type: "movie",
                name: cleaned,
                genres: ["BDIX Stream", "Movies"],
                poster: posterUrl,
                background: posterUrl,
                description: `Direct BDIX High-Speed Stream from FMFTP Server. Movie: ${cleaned}`
            }
        };
    } catch (e) {
        console.error("Meta error:", e.message);
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
        console.error("Error fetching stream:", error.message);
    }

    return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
