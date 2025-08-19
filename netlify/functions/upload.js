import { Blob } from "@netlify/blobs";

export const handler = async (event, context) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const user = context.clientContext && context.clientContext.user;
    if (!user) {
      return { statusCode: 401, body: "Unauthorized" };
    }

    const formData = await parseMultipartForm(event);
    const file = formData.file;
    const quote = formData.quote;

    if (!file || !quote) {
      return { statusCode: 400, body: "Missing file or quote" };
    }

    const blobStore = new Blob({ namespace: "uploads" });

    // Save image
    const fileName = `${Date.now()}-${file.filename}`;
    await blobStore.set(fileName, file.content);

    // Save metadata (quote)
    const metaName = `${fileName}.json`;
    await blobStore.setJSON(metaName, { quote });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Uploaded successfully" }),
    };
  } catch (err) {
    return { statusCode: 500, body: "Server error: " + err.message };
  }
};

// --- Helper to parse multipart form ---
import multiparty from "multiparty";
import { promisify } from "util";

async function parseMultipartForm(event) {
  return new Promise((resolve, reject) => {
    const form = new multiparty.Form();
    form.parse(event, (err, fields, files) => {
      if (err) reject(err);
      else {
        resolve({
          file: {
            filename: files.file[0].originalFilename,
            content: require("fs").readFileSync(files.file[0].path),
          },
          quote: fields.quote[0],
        });
      }
    });
  });
}
