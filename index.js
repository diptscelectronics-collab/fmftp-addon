const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://fmftp.net/data/disk-1/movies/";

// অ্যাড-অনের পরিচিতি
const manifest = {
    id: "org.fmftp.allmovies.nuvio",
    version: "1.0.0",
    name: "FMFTP Movies",
    description: "Stream movies directly from FMFTP BDIX Server",
    resources: ["catalog", "stream"],
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

// ক্যাটালগ হ্যান্ডলার (মুভির লিস্ট লোড করবে)
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

                if (folderHref && !folderHref.startsWith("?") && !folderHref.startsWith("/")) {
                    const cleanName = folderName.replace(/\//g, "");
                    const fullPath = catUrl + folderHref;

                    allMovies.push({
                        id: "fmftp_" + encodeURIComponent(fullPath),
                        type: "movie",
                        name: decodeURIComponent(cleanName),
                        poster: "https://via.placeholder.com/300x450.png?text=" + encodeURIComponent(cleanName)
                    });
                }
            });
        }
        return { metas: allMovies };
    } catch (error) {
        console.error("Error fetching catalog:", error);
        return { metas: [] };
    }
});

// স্ট্রিম হ্যান্ডলার (ভিডিও প্লে করার আসল লিঙ্ক তৈরি করবে)
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
                        title: "FMFTP Direct Stream (BDIX)",
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

// সার্ভার পোর্ট সেটিংস
serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
