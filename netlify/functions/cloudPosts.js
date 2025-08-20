const fs = require('fs');
const path = require('path');

exports.handler = async () => {
    const jsonPath = path.join(__dirname, "gallery.json");
    let data = [];
    if(fs.existsSync(jsonPath)) data = JSON.parse(fs.readFileSync(jsonPath));
    return {
        statusCode: 200,
        body: JSON.stringify(data)
    };
};
