const fs = require('fs');
const path = require('path');

exports.handler = async (event) => {
    try {
        // Use a multipart parser for actual file upload
        // Here simplified: assume file URL is generated (like Cloudinary)
        // In production, integrate Cloudinary/S3

        // For demonstration:
        const body = event.body; // replace with actual file + quote parsing
        const url = "/daily/" + Date.now() + ".jpg"; // temp generated URL
        const quote = event.queryStringParameters.quote || "No quote";

        // Load existing JSON
        const jsonPath = path.join(__dirname, "gallery.json");
        let data = [];
        if(fs.existsSync(jsonPath)) data = JSON.parse(fs.readFileSync(jsonPath));

        data.unshift({ url, quote }); // newest first
        fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));

        return { statusCode: 200, body: JSON.stringify({ success:true }) };
    } catch(err) {
        return { statusCode: 500, body: JSON.stringify({ success:false, error: err.message }) };
    }
};
