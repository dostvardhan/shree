import { Blob } from "@netlify/blobs";

export const handler = async () => {
  try {
    const blobStore = new Blob({ namespace: "uploads" });
    const keys = await blobStore.list();

    const items = [];
    for (const key of keys.blobs) {
      if (key.key.endsWith(".json")) {
        const quoteData = await blobStore.getJSON(key.key);
        const fileKey = key.key.replace(".json", "");
        const url = blobStore.getURL(fileKey);

        items.push({ url, quote: quoteData.quote });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify(items),
    };
  } catch (err) {
    return { statusCode: 500, body: "Server error: " + err.message };
  }
};
