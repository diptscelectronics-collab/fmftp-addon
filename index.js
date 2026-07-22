const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://fmftp.net/data/disk-1/movies/";

const manifest = {
    id: "org.fmftp.allmovies.nuvio",
    version: "1.0.2",
    name: "FMFTP Movies",
    description: "Stream movies directly from FMFTP BDIX Server",
    resources: ["catalog", "meta", "stream"], // meta যোগ করা হয়েছে
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
                            poster: `https://dummyimage.com/300x450/1a1a1a/ffffff.png&text=${encodeURIComponent(cleanName)}`
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

// ২. মেটা হ্যান্ডলার (এই অংশটি নতুন যুক্ত করা হয়েছে, যা এরর সমাধান করবে)
builder.defineMetaHandler(async (args) => {
    const folderUrl = decodeURIComponent(args.id.replace("fmftp_", ""));
    const pathParts = folderUrl.split("/").filter(Boolean);
    const movieName = decodeURIComponent(pathParts[pathParts.length - 1] || "Movie");

    return {
        meta: {
            id: args.id,
            type: "movie",
            name: movieName,
            poster: `https://dummyimage.com/300x450/1a1a1a/ffffff.png&text=${encodeURIComponent(movieName)}`,
            description: "Direct stream from FMFTP BDIX server: " + movieName
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
